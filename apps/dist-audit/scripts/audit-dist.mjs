#!/usr/bin/env node
/**
 * Аудит собранного дистрибутива: что из пакета доехало, а что обязано было
 * исчезнуть.
 *
 * Стенд держит ровно один компонент из двух, поэтому у каждого вопроса есть
 * однозначный ответ, и любой «лишний» байт назван поимённо:
 *
 *   1. код невыбранного компонента — его классы не должны встречаться в JS;
 *   2. классы и собственный CSS невыбранного компонента — не должны быть в CSS;
 *   3. объявленные токены пакета, до которых из дистрибутива не дотянуться, —
 *      мёртвый груз обрезки;
 *   4. классы выбранного компонента и его CSS — наоборот, обязаны быть.
 *
 * Источник правды о пакете — его `granum.manifest.json`, а не догадки по
 * именам файлов: классы и потребляемые токены посчитаны на сборке пакета.
 *
 * Запуск: `yarn workspace @granum-apps/dist-audit audit:dist`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

import { declaredTokens, reachableTokens } from '../../../scripts/lib/cssBudget.mjs'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const assetsDir = join(appDir, 'dist', 'assets')
const reportPath = join(appDir, 'dist', 'granum-report.json')

if (!existsSync(assetsDir)) {
  console.error(`audit-dist: нет ${assetsDir} — сначала \`yarn build\``)
  process.exit(1)
}

const require = createRequire(join(appDir, 'package.json'))
const manifestPath = require.resolve('@granum-fixtures/mini-ds/granum.manifest.json')
const packageDist = dirname(manifestPath)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null

const files = readdirSync(assetsDir).filter(name => /\.(?:css|js)$/.test(name)).sort()
const read = ext => files
  .filter(name => name.endsWith(ext))
  .map(name => readFileSync(join(assetsDir, name), 'utf8'))
  .join('\n')
const css = read('.css')
const js = read('.js')
/** Экранирование в селекторах снимаем: `.bg-\[var\(--x\)\]` → `.bg-[var(--x)]`. */
const cssPlain = css.replace(/\\(.)/g, '$1')

/** Классы-селекторы собственного CSS компонента — по файлу из раскладки пакета. */
function ownSelectors(component) {
  const out = []
  for (const path of component.css) {
    const text = readFileSync(join(packageDist, path), 'utf8')
    for (const match of text.matchAll(/^\s*\.([\w-]+)/gm))
      out.push(match[1])
  }
  return [...new Set(out)]
}

const selected = new Set((report?.selection ?? []).map(entry => entry.key.slice(entry.key.lastIndexOf(':') + 1)))
if (selected.size === 0) {
  console.error('audit-dist: в отчёте сборки нет селекции — проверьте `report.file` в granum.config.ts')
  process.exit(1)
}

const problems = []
const lines = []
const pad = (text, width) => String(text).padEnd(width)

lines.push('Аудит дистрибутива — apps/dist-audit', '')
lines.push(`Пакет: ${manifest.id}@${manifest.version} — компонентов ${Object.keys(manifest.components).length}, объявлено токенов ${manifest.theme.declares.length}`)
lines.push(`Селекция приложения: ${[...selected].join(', ')}`)
lines.push('')

lines.push('КОМПОНЕНТЫ')
for (const [name, component] of Object.entries(manifest.components)) {
  const inSelection = selected.has(name)
  // Код компонента опознаём по его же классам из манифеста: в собранном
  // рендере они лежат строками. Имя файла для этого не годится — чанки
  // приложения называются иначе, чем чанки пакета.
  const jsHits = component.classes.filter(className => js.includes(className))
  const cssHits = component.classes.filter(className => cssPlain.includes(`.${className}`))
  const selectors = ownSelectors(component)
  const cssOwn = selectors.filter(selector => cssPlain.includes(`.${selector}`))

  lines.push(`  ${pad(name, 10)} ${inSelection ? 'в селекции' : 'НЕ выбран '}  JS: ${jsHits.length}/${component.classes.length} классов · CSS: ${cssHits.length}/${component.classes.length} · свой CSS: ${cssOwn.length}/${selectors.length}`)

  if (inSelection) {
    const missing = component.classes.filter(className => !cssHits.includes(className))
    if (missing.length > 0)
      problems.push(`${name}: в CSS нет классов ${missing.join(', ')}`)
    if (cssOwn.length !== selectors.length)
      problems.push(`${name}: в CSS нет собственных правил ${selectors.filter(s => !cssOwn.includes(s)).join(', ')}`)
  }
  else {
    if (jsHits.length > 0)
      problems.push(`${name}: код невыбранного компонента в JS — tree-shaking не сработал (${jsHits.join(', ')})`)
    if (cssHits.length > 0)
      problems.push(`${name}: классы невыбранного компонента в CSS (${cssHits.join(', ')})`)
    if (cssOwn.length > 0)
      problems.push(`${name}: собственный CSS невыбранного компонента приехал (${cssOwn.join(', ')})`)
  }
}

lines.push('', 'ТОКЕНЫ ПАКЕТА')
const declared = declaredTokens(css)
const reachable = reachableTokens(css, js)
const packageTokens = manifest.theme.declares.map(token => token.replace(/^--/, ''))
const inDist = packageTokens.filter(token => declared.has(token))
const cut = packageTokens.filter(token => !declared.has(token))
const dead = inDist.filter(token => !reachable.has(token))

lines.push(`  объявлено пакетом:           ${packageTokens.length}`)
lines.push(`  доехало в дистрибутив:       ${inDist.length} — ${inDist.map(token => `--${token}`).join(' ') || '—'}`)
lines.push(`  вырезано обрезкой:           ${cut.length} — ${cut.map(token => `--${token}`).join(' ') || '—'}`)
lines.push(`  мёртвый груз в дистрибутиве: ${dead.length} — ${dead.map(token => `--${token}`).join(' ') || '—'}`)

if (dead.length > 0)
  problems.push(`токены пакета в дистрибутиве, до которых не дотянуться: ${dead.map(token => `--${token}`).join(' ')}`)

// Переменные preflight'а движка (`--un-*`) токенами пакета не являются и
// обрезке не подлежат: их объявляет preset-mini одним блоком на весь набор
// утилит. Это фиксированная цена движка, и аудит называет её отдельно, а не
// прячет в находках пакета. Снимается `engine: { preflight: false }` — но
// тогда утилиты, которые на эти переменные ссылаются, перестанут работать.
const enginePrefix = 'un-'
const engineVars = [...declared].filter(token => token.startsWith(enginePrefix)).sort()
const engineUsed = engineVars.filter(token => reachable.has(token))

lines.push('', 'PREFLIGHT ДВИЖКА')
lines.push(`  объявлено --${enginePrefix}*: ${engineVars.length}, из них используется утилитами сборки: ${engineUsed.length}`)
lines.push('  фиксированная цена preset-mini; к пакету и его обрезке отношения не имеет')

const foreign = [...declared].filter(token => !token.startsWith('xxx-') && !token.startsWith(enginePrefix)).sort()
if (foreign.length > 0)
  lines.push('', `ЧУЖИЕ ОБЪЯВЛЕНИЯ: ${foreign.map(token => `--${token}`).join(' ')}`)

if (report) {
  lines.push('', 'ОТЧЁТ СБОРКИ')
  lines.push(`  классы: ${report.classes.matched} с правилом из ${report.classes.input} кандидатов; без правила: ${report.classes.unmatched.length}`)
  lines.push(`  токены без объявления: ${report.tokens.undefined.join(' ') || '—'}`)
  if (report.prune)
    lines.push(`  обрезка (${report.prune.mode}): удалено ${report.prune.removable.length}, сохранено ${report.prune.kept}, мёртвых шаблонов ${report.prune.deadPatterns.length}`)
  lines.push(`  слои (raw / gzip, источник — ${report.sizesSource}):`)
  for (const [layer, size] of Object.entries(report.sizes))
    lines.push(`    ${pad(layer, 12)} ${pad(size.raw, 7)} ${size.gzip}`)

  if (report.classes.unmatched.length > 0)
    problems.push(`классы без правила движка: ${report.classes.unmatched.map(entry => entry.className).join(', ')}`)
  if (report.tokens.undefined.length > 0)
    problems.push(`потребляются, но не объявлены: ${report.tokens.undefined.join(', ')}`)
}

lines.push('')
lines.push(problems.length === 0
  ? '✓ Лишнего в дистрибутиве нет: невыбранный компонент вырезан целиком, недостижимых токенов не осталось.'
  : `✗ Находок: ${problems.length}\n  - ${problems.join('\n  - ')}`)

process.stdout.write(`${lines.join('\n')}\n`)
process.exitCode = problems.length === 0 ? 0 : 1
