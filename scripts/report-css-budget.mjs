#!/usr/bin/env node
/**
 * Бюджет CSS/JS собранного стенда (N-4, N-5): что уехало в дистрибутив,
 * сколько весит по ролям и по слоям granum, какие токены дистрибутива не
 * достижимы. Запускается из каталога стенда (`yarn workspace <name> sizes:check`)
 * или с `--stand <name>` из корня.
 *
 * Порога на байты НЕТ: gzip невоспроизводим между средами, а порог с потолка
 * краснеет на честном росте. Гейтятся только булевы факты (`--strict`) из
 * `expected-budget.mjs`; байты печатаются рядом с `hints` как ориентир.
 *
 *   node scripts/report-css-budget.mjs --stand bench-one [--baseline bench-zero] [--json] [--strict]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { classifyAsset, declaredTokens, formatBytes, formatDelta, reachableTokens, strictCheck } from './lib/cssBudget.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const named = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const cwdName = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).name
const standName = named('--stand', existsSync(join(process.cwd(), 'expected-budget.mjs')) ? cwdName.replace(/^@granum-apps\//, '') : 'bench-one')
const baselineName = named('--baseline', standName === 'bench-one' ? 'bench-zero' : (standName === 'bench-pruned' ? 'bench-one' : undefined))

function readStand(name) {
  const dir = join(ROOT, 'apps', name)
  const assetsDir = join(dir, 'dist', 'assets')
  if (!existsSync(assetsDir))
    throw new Error(`нет '${assetsDir}'. Сначала: yarn build:all`)
  const assets = readdirSync(assetsDir).filter(f => /\.(?:css|js)$/.test(f)).sort().map((file) => {
    const buffer = readFileSync(join(assetsDir, file))
    return { file, kind: file.endsWith('.css') ? 'css' : 'js', role: classifyAsset(file), raw: buffer.length, gzip: gzipSync(buffer).length, brotli: brotliCompressSync(buffer).length, text: buffer.toString('utf8') }
  })
  const unknown = assets.filter(a => a.role === undefined)
  if (unknown.length)
    throw new Error(`раскладка стенда '${name}' разошлась с классификатором: не опознаны ${unknown.map(a => a.file).join(', ')}. Корзины «прочее» нет намеренно — правьте ASSET_ROLES в scripts/lib/cssBudget.mjs`)
  const reportPath = join(dir, 'dist', 'granum-report.json')
  return { name, dir, assets, report: existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null }
}

function rolesOf(stand) {
  const roles = {}
  for (const a of stand.assets) {
    const r = roles[a.role] ?? (roles[a.role] = { raw: 0, gzip: 0, brotli: 0 })
    r.raw += a.raw
    r.gzip += a.gzip
    r.brotli += a.brotli
  }
  return roles
}

const stand = readStand(standName)
const baseline = baselineName && existsSync(join(ROOT, 'apps', baselineName, 'dist', 'assets')) ? readStand(baselineName) : null
const css = stand.assets.filter(a => a.kind === 'css').map(a => a.text).join('\n')
const js = stand.assets.filter(a => a.kind === 'js').map(a => a.text).join('\n')
const declared = declaredTokens(css)
const reachable = reachableTokens(css, js)
const subject = [...declared].filter(t => !t.startsWith('un-'))
const unused = subject.filter(t => !reachable.has(t)).sort()
const roles = rolesOf(stand)
const total = kind => stand.assets.filter(a => !kind || a.kind === kind).reduce((s, a) => ({ raw: s.raw + a.raw, gzip: s.gzip + a.gzip, brotli: s.brotli + a.brotli }), { raw: 0, gzip: 0, brotli: 0 })

const report = {
  stand: standName,
  baseline: baseline?.name ?? null,
  env: { node: process.version, platform: process.platform, arch: process.arch },
  assets: stand.assets.map(({ text, ...rest }) => rest),
  roles,
  totals: { all: total(), css: total('css'), js: total('js'), withoutVue: (() => {
    const t = total()
    const v = roles.vue ?? { raw: 0, gzip: 0, brotli: 0 }
    return { raw: t.raw - v.raw, gzip: t.gzip - v.gzip, brotli: t.brotli - v.brotli }
  })() },
  tokens: { declared: subject.length, reachable: subject.length - unused.length, unused },
  engineInBundle: /granularity-spin|\bcreateGenerator\b|presetMini/.test(js),
  granum: stand.report
    ? { selection: stand.report.selection.map(s => s.key), layers: stand.report.sizes, sizesSource: stand.report.sizesSource ?? 'emission', emissionLayers: stand.report.emissionSizes ?? stand.report.sizes, unmatched: stand.report.classes.unmatched.map(u => u.className), undefinedTokens: stand.report.tokens.undefined, prune: stand.report.prune ?? { mode: 'off' } }
    : null,
}
const expectedFile = join(stand.dir, 'expected-budget.mjs')
const expected = existsSync(expectedFile) ? (await import(pathToFileURL(expectedFile).href)).default : null
const checks = expected ? strictCheck(expected, report) : []
report.strict = { checked: checks.length, failures: checks.filter(c => !c.ok) }

if (flag('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
else {
  const out = []
  const pad = (s, n) => String(s).padStart(n)
  out.push(`Бюджет CSS/JS — ${standName}${baseline ? ` против ${baseline.name}` : ''}`, `${process.version} · ${process.platform}/${process.arch}; gzip/brotli сопоставимы внутри прогона`, '')
  out.push('АССЕТЫ                                     raw     gzip   brotli')
  for (const a of stand.assets)
    out.push(`  ${a.file.padEnd(34)} ${pad(formatBytes(a.raw), 9)} ${pad(formatBytes(a.gzip), 8)} ${pad(formatBytes(a.brotli), 8)}`)
  out.push('', `РОЛИ (gzip)${baseline ? `            ${baseline.name.padStart(12)} ${standName.padStart(12)}        Δ` : ''}`)
  const baseRoles = baseline ? rolesOf(baseline) : {}
  for (const role of [...new Set([...Object.keys(baseRoles), ...Object.keys(roles)])].sort()) {
    const b = baseRoles[role]?.gzip ?? 0
    const s = roles[role]?.gzip ?? 0
    out.push(`  ${role.padEnd(20)} ${baseline ? `${pad(formatBytes(b), 12)} ` : ''}${pad(formatBytes(s), 12)} ${baseline ? pad(formatDelta(s - b), 8) : ''}`)
  }
  if (baseline) {
    const b = baseline.assets.reduce((n, a) => n + a.gzip, 0)
    const bv = rolesOf(baseline).vue?.gzip ?? 0
    out.push(`  ${'всего'.padEnd(20)} ${pad(formatBytes(b), 12)} ${pad(formatBytes(report.totals.all.gzip), 12)} ${pad(formatDelta(report.totals.all.gzip - b), 8)}`)
    out.push(`  ${'без vue'.padEnd(20)} ${pad(formatBytes(b - bv), 12)} ${pad(formatBytes(report.totals.withoutVue.gzip), 12)} ${pad(formatDelta(report.totals.withoutVue.gzip - (b - bv)), 8)}`)
  }
  if (report.granum) {
    out.push('', `СЛОИ GRANUM (${report.granum.sizesSource === 'bundle' ? 'из бандла после минификации' : 'эмиссия до минификации'}, granum-report.json)      raw     gzip`)
    for (const [layer, size] of Object.entries(report.granum.layers))
      out.push(`  ${layer.padEnd(56)} ${pad(formatBytes(size.raw), 8)} ${pad(formatBytes(size.gzip), 8)}`)
    out.push(`  селекция: ${report.granum.selection.join(', ')}`)
    out.push(`  классы без правила: ${report.granum.unmatched.join(', ') || '—'}; токены без объявления: ${report.granum.undefinedTokens.join(', ') || '—'}`)
    if (report.granum.prune.mode !== 'off')
      out.push(`  обрезка (${report.granum.prune.mode}): удаляемых ${report.granum.prune.removable.length}, сохранённых ${report.granum.prune.kept}, мёртвых шаблонов ${report.granum.prune.deadPatterns.length}`)
  }
  out.push('', `ТОКЕНЫ В ДИСТРИБУТИВЕ: объявлено ${report.tokens.declared}, достижимо ${report.tokens.reachable}, мёртвый груз ${unused.length}${unused.length ? `:\n  ${unused.join(' ')}` : ''}`)
  if (expected?.hints)
    out.push('', `ОРИЕНТИРЫ (не гейт): ${Object.entries(expected.hints).map(([k, v]) => `${k}=${formatBytes(v)}`).join(', ')}`)
  if (expected) {
    out.push('', 'СВЕРКА С expected-budget.mjs')
    for (const c of checks)
      out.push(c.ok ? `  ✓ ${c.name.padEnd(28)} совпало` : `  ✗ ${c.name.padEnd(28)} получили [${c.actual}], ждали [${c.want}]`)
    out.push(report.strict.failures.length ? `✗ расхождений: ${report.strict.failures.length} из ${checks.length}` : `✓ ${checks.length} строгих проверок — расхождений нет`)
  }
  process.stdout.write(`${out.join('\n')}\n`)
}
process.exitCode = flag('--strict') && report.strict.failures.length > 0 ? 1 : 0
