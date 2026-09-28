#!/usr/bin/env node
/**
 * Сверка собранного приложения с `expected.mjs` (AC-5): подстроки в CSS и JS
 * из `dist/assets`, плюс проверки отчёта `granum-report.json`. Запускается
 * из каталога приложения: `yarn workspace <name> verify`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { auditFailure } from './audit-dist.mjs'

const dir = process.cwd()
const assetsDir = join(dir, 'dist', 'assets')
if (!existsSync(assetsDir)) {
  console.error(`verify-app: нет ${assetsDir} — сначала \`yarn build\``)
  process.exit(1)
}
const read = ext => readdirSync(assetsDir).filter(f => f.endsWith(ext)).map(f => readFileSync(join(assetsDir, f), 'utf8')).join('\n')
const expected = (await import(pathToFileURL(join(dir, 'expected.mjs')).href)).default
const failures = []

function match(haystack, { present = [], absent = [] }, field) {
  for (const item of present) {
    if (!haystack.includes(item[field]))
      failures.push(`ОЖИДАЛОСЬ, но нет: ${item.what}\n      искали: ${JSON.stringify(item[field])}`)
  }
  for (const item of absent) {
    if (haystack.includes(item[field]))
      failures.push(`НЕ ДОЛЖНО БЫТЬ, но есть: ${item.what}\n      нашли: ${JSON.stringify(item[field])}`)
  }
}

if (expected.css)
  match(read('.css'), expected.css, 'css')
if (expected.js)
  match(read('.js'), expected.js, 'js')
if (expected.report) {
  const reportPath = join(dir, 'dist', 'granum-report.json')
  if (!existsSync(reportPath)) {
    failures.push('нет dist/granum-report.json')
  }
  else {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    expected.report(report, (ok, message) => { if (!ok) failures.push(`отчёт: ${message}`) })
  }
}

const bin = createRequire(join(dir, 'package.json')).resolve('@feugene/granum/package.json').replace(/package\.json$/, 'dist/bin.js')

// CLI на настоящем `granum.config.ts`: `doctor` обязан пройти без ошибок и
// отдать JSON с той же селекцией, что в отчёте сборки (D-4, INV-DIAG-1).
// Стенд без granum (`noGranum`) конфига не имеет — пропуск.
if (expected.noGranum) {
  if (existsSync(join(dir, 'dist', 'granum-report.json')))
    failures.push('стенд без granum, а dist/granum-report.json есть')
}
else {
  runDoctor()
  const audit = auditFailure(dir)
  if (audit)
    failures.push(audit)
}

function runDoctor() {
const doctor = spawnSync(process.execPath, [bin, 'doctor', 'granum.config.ts', '--json'], { cwd: dir, encoding: 'utf8' })
if (doctor.status !== 0) {
  failures.push(`granum doctor завершился кодом ${doctor.status}:\n${doctor.stderr || doctor.stdout}`)
}
else {
  const report = JSON.parse(doctor.stdout)
  const selection = report.components.map(c => c.key)
  const reportPath = join(dir, 'dist', 'granum-report.json')
  const built = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')).selection.map(s => s.key) : selection
  if (JSON.stringify(selection) !== JSON.stringify(built))
    failures.push(`granum doctor видит селекцию ${JSON.stringify(selection)}, а сборка — ${JSON.stringify(built)}`)

  /*
   * Предупреждения доктора приложение объявляет поимённо, а не гасит `--strict`.
   *
   * Часть находок законна и объяснима (токен, который даёт само приложение;
   * мёртвая запись safelist в фикстуре), и списком их видно в `expected.mjs`
   * рядом с причиной. Зато любая НОВАЯ находка роняет сверку — то, чего
   * `--strict` дать не может: он либо запрещает всё, либо не проверяет ничего.
   */
  const counted = {}
  for (const diagnostic of report.diagnostics)
    counted[diagnostic.code] = (counted[diagnostic.code] ?? 0) + 1
  const declared = expected.doctor?.warnings ?? {}
  for (const code of [...new Set([...Object.keys(counted), ...Object.keys(declared)])].sort()) {
    const got = counted[code] ?? 0
    const want = declared[code] ?? 0
    if (got !== want) {
      const messages = report.diagnostics.filter(d => d.code === code).map(d => `${d.subject}: ${d.message}`)
      failures.push(`doctor: находок \`${code}\` — ${got}, объявлено в expected.doctor — ${want}${messages.length ? `\n      ${messages.join('\n      ')}` : ''}`)
    }
  }
}
}

const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
if (failures.length > 0) {
  console.error(`verify-app: ✗ ${name} — ${expected.purpose}\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log(`verify-app: ✓ ${name} — ${expected.purpose}`)
