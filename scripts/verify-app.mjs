#!/usr/bin/env node
/**
 * Сверка собранного приложения с `expected.mjs`: подстроки в CSS и JS
 * из `dist/assets`, значения токенов по блокам пар, плюс проверки отчёта
 * `granum-report.json`. Запускается
 * из каталога приложения: `yarn workspace <name> verify`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { extractLayerBlocks } from '@feugene/granum/node'
import { auditFailure } from './audit-dist.mjs'
import { tokenValue } from './lib/cssValues.mjs'
import { pageStylesheets } from './lib/pageStylesheets.mjs'

const dir = process.cwd()
const assetsDir = join(dir, 'dist', 'assets')
if (!existsSync(assetsDir)) {
  console.error(`verify-app: нет ${assetsDir} — сначала \`yarn build\``)
  process.exit(1)
}
const read = ext => readdirSync(assetsDir).filter(f => f.endsWith(ext)).map(f => readFileSync(join(assetsDir, f), 'utf8')).join('\n')
const expected = (await import(pathToFileURL(join(dir, 'expected.mjs')).href)).default
const failures = []

/**
 * `layer` у ожидания сужает поиск до блоков `@layer granum.<layer>` собранного
 * CSS: «значение в слое themes» и «значение где-то в CSS» — разные утверждения,
 * и слой решает, победит ли значение в каскаде.
 */
function match(haystack, { present = [], absent = [] }, field, layers) {
  const where = item => (item.layer === undefined ? haystack : layers?.get(item.layer) ?? '')
  const label = item => (item.layer === undefined ? item.what : `${item.what} (слой ${item.layer})`)
  for (const item of present) {
    if (!where(item).includes(item[field]))
      failures.push(`ОЖИДАЛОСЬ, но нет: ${label(item)}\n      искали: ${JSON.stringify(item[field])}`)
  }
  for (const item of absent) {
    if (where(item).includes(item[field]))
      failures.push(`НЕ ДОЛЖНО БЫТЬ, но есть: ${label(item)}\n      нашли: ${JSON.stringify(item[field])}`)
  }
}

if (expected.css) {
  const css = read('.css')
  match(css, expected.css, 'css', extractLayerBlocks(css, 'granum').blocks)
}
// Значение токена под селектором пары: подстрока по всей склейке не различит,
// из какого блока пришло значение, — тема могла показать чужое.
if (expected.values) {
  const css = read('.css')
  for (const { what, selector, token, value } of expected.values) {
    const found = tokenValue(css, selector, token)
    if (found !== value)
      failures.push(`ЗНАЧЕНИЕ: ${what}\n      ${selector} ${token}: ожидали ${JSON.stringify(value)}, нашли ${JSON.stringify(found)}`)
  }
}
if (expected.js)
  match(read('.js'), expected.js, 'js')
// HTML страниц сборки: что плагин вставил в `<head>` — скрипт до первого кадра, ссылки.
if (expected.html) {
  const html = readdirSync(join(dir, 'dist')).filter(f => f.endsWith('.html')).map(f => readFileSync(join(dir, 'dist', f), 'utf8')).join('\n')
  match(html, expected.html, 'html')
}
// CSS каждой HTML-страницы сборки — листы, которые она подключает. Склейка всех
// ассетов не различит, что одна страница получила лист, а другая нет.
if (expected.pages) {
  const pages = {}
  for (const page of readdirSync(join(dir, 'dist')).filter(f => f.endsWith('.html'))) {
    const html = readFileSync(join(dir, 'dist', page), 'utf8')
    pages[page] = pageStylesheets(html).map(name => readFileSync(join(assetsDir, name), 'utf8')).join('\n')
  }
  expected.pages(pages, (ok, message) => { if (!ok) failures.push(`страницы: ${message}`) })
}
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
// отдать JSON с той же селекцией, что в отчёте сборки.
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
  // Число находок не говорит, о чём они: предметы сверяются отдельно.
  expected.doctor?.check?.(report, (ok, message) => { if (!ok) failures.push(`doctor: ${message}`) })
}
}

const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
if (failures.length > 0) {
  console.error(`verify-app: ✗ ${name} — ${expected.purpose}\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log(`verify-app: ✓ ${name} — ${expected.purpose}`)
