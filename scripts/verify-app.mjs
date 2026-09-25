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

// CLI на настоящем `granum.config.ts`: `doctor` обязан пройти без ошибок и
// отдать JSON с той же селекцией, что в отчёте сборки (D-4, INV-DIAG-1).
const bin = createRequire(join(dir, 'package.json')).resolve('@feugene/granum/package.json').replace(/package\.json$/, 'dist/bin.js')
const doctor = spawnSync(process.execPath, [bin, 'doctor', 'granum.config.ts', '--json'], { cwd: dir, encoding: 'utf8' })
if (doctor.status !== 0) {
  failures.push(`granum doctor завершился кодом ${doctor.status}:\n${doctor.stderr || doctor.stdout}`)
}
else {
  const selection = JSON.parse(doctor.stdout).components.map(c => c.key)
  const reportPath = join(dir, 'dist', 'granum-report.json')
  const built = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')).selection.map(s => s.key) : selection
  if (JSON.stringify(selection) !== JSON.stringify(built))
    failures.push(`granum doctor видит селекцию ${JSON.stringify(selection)}, а сборка — ${JSON.stringify(built)}`)
}

const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
if (failures.length > 0) {
  console.error(`verify-app: ✗ ${name} — ${expected.purpose}\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log(`verify-app: ✓ ${name} — ${expected.purpose}`)
