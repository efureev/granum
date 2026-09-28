#!/usr/bin/env node
/**
 * Время сборки стенда (пункт 2.3 роадмапа): сколько занимает сборка целиком и
 * сколько в ней granum. Запускается из каталога стенда (`yarn time:check`) или
 * с `--stand <name>` из корня.
 *
 *   node scripts/report-build-time.mjs --stand bench-one [--runs 3] [--baseline bench-zero] [--json] [--strict]
 *
 * Порога на миллисекунды НЕТ по той же причине, по какой в бюджете CSS нет
 * порога на байты: число зависит от машины и нагрузки, а порог с потолка
 * краснеет на честном росте. Гейтятся факты о РАБОТЕ из `expected-build.mjs`
 * (пересчёт классов, число классов на входе генератора, размер селекции) и
 * одна относительная величина — доля granum в сборке. Секунды печатаются
 * рядом как ориентир.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { median, parseGranumTime, spread, strictBuildCheck, workFacts } from './lib/buildTime.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const named = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const cwdPackage = existsSync(join(process.cwd(), 'package.json'))
  ? JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).name
  : null
const standName = named('--stand', cwdPackage?.startsWith('@granum-apps/') ? cwdPackage.replace('@granum-apps/', '') : 'bench-one')
const runs = Number(named('--runs', '3'))
const baselineName = named('--baseline', undefined)

/**
 * Один прогон: чистый `dist`, сборка, замер.
 *
 * `dist` удаляется намеренно: сборка поверх готового каталога мерила бы не то
 * же самое, что сборка в CI, а разницу между ними никто бы не заметил.
 */
function buildOnce(name) {
  const dir = join(ROOT, 'apps', name)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
  rmSync(join(dir, 'dist'), { recursive: true, force: true })
  const started = performance.now()
  const result = spawnSync('yarn', ['-s', 'workspace', pkg, 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
  })
  const wall = performance.now() - started
  if (result.status !== 0)
    throw new Error(`сборка '${name}' упала:\n${(result.stderr || result.stdout || '').slice(-800)}`)
  return { wall, granum: parseGranumTime(`${result.stdout}\n${result.stderr}`) }
}

function measure(name) {
  const walls = []
  const phases = { total: [], prepare: [], emit: [], report: [] }
  for (let i = 0; i < runs; i++) {
    const { wall, granum } = buildOnce(name)
    walls.push(wall)
    if (granum) {
      for (const key of Object.keys(phases))
        phases[key].push(granum[key])
    }
  }
  return { walls, phases }
}

const stand = measure(standName)
const baseline = baselineName ? measure(baselineName) : null

const wallMedian = median(stand.walls)
const granumMedian = median(stand.phases.total)
const reportPath = join(ROOT, 'apps', standName, 'dist', 'granum-report.json')
const buildReport = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null

const report = {
  stand: standName,
  runs,
  env: { node: process.version, platform: process.platform, arch: process.arch },
  time: {
    wallMs: Math.round(wallMedian),
    wallSpread: Number(spread(stand.walls).toFixed(2)),
    granumMs: Math.round(granumMedian),
    phases: Object.fromEntries(['prepare', 'emit', 'report'].map(k => [k, Math.round(median(stand.phases[k]))])),
    granumShare: wallMedian === 0 ? 0 : Number((granumMedian / wallMedian).toFixed(3)),
    baseline: baseline ? { stand: baselineName, wallMs: Math.round(median(baseline.walls)) } : null,
  },
  work: buildReport ? workFacts(buildReport) : null,
}

const expectedFile = join(ROOT, 'apps', standName, 'expected-build.mjs')
const expected = existsSync(expectedFile) ? (await import(pathToFileURL(expectedFile).href)).default : null
const checks = expected && report.work ? strictBuildCheck(expected, report) : []
report.strict = { checked: checks.length, failures: checks.filter(c => !c.ok) }

if (flag('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
else {
  const out = []
  const pad = (s, n) => String(s).padStart(n)
  out.push(
    `Время сборки — ${standName} (${runs} прогон(а/ов), медиана)`,
    `${process.version} · ${process.platform}/${process.arch}; числа сопоставимы только внутри одной машины`,
    '',
  )
  out.push(`СБОРКА ЦЕЛИКОМ: ${pad(report.time.wallMs, 6)} мс   разброс ${(report.time.wallSpread * 100).toFixed(0)}%`)
  if (report.time.baseline)
    out.push(`  стенд без granum (${report.time.baseline.stand}): ${report.time.baseline.wallMs} мс`)
  out.push('')
  out.push(`GRANUM В НЕЙ:   ${pad(report.time.granumMs, 6)} мс   ${(report.time.granumShare * 100).toFixed(0)}% сборки`)
  for (const [phase, ms] of Object.entries(report.time.phases))
    out.push(`  ${phase.padEnd(10)} ${pad(ms, 6)} мс`)
  out.push('  prepare — манифесты, пересчёт классов, скан исходников, резолюция')
  out.push('  emit    — генератор утилит и сборка слоёв')
  out.push('  report  — размеры слоёв со сжатием и запись файла')

  if (report.work) {
    out.push('', 'РАБОТА (из отчёта сборки; это и гейтится)')
    out.push(`  провайдеров ${report.work.providers}, пересчёт классов: ${report.work.reextract.join(', ')}, источник классов: ${report.work.classSources.join(', ')}`)
    out.push(`  классов на входе генератора ${report.work.classesInput}, с правилом ${report.work.classesMatched}, компонентов в селекции ${report.work.selection}`)
  }

  if (expected?.hints) {
    // Ориентир, а НЕ гейт: числа с машины автора, чтобы было с чем сравнить свои.
    out.push('', `ОРИЕНТИРЫ (не гейт): ${Object.entries(expected.hints).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  }

  if (expected) {
    out.push('', 'СВЕРКА С expected-build.mjs')
    for (const c of checks)
      out.push(c.ok ? `  ✓ ${c.name.padEnd(24)} совпало` : `  ✗ ${c.name.padEnd(24)} получили [${c.actual}], ждали [${c.want}]`)
    out.push(report.strict.failures.length ? `✗ расхождений: ${report.strict.failures.length} из ${checks.length}` : `✓ ${checks.length} строгих проверок — расхождений нет`)
  }
  process.stdout.write(`${out.join('\n')}\n`)
}
process.exitCode = flag('--strict') && report.strict.failures.length > 0 ? 1 : 0
