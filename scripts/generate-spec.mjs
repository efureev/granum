#!/usr/bin/env node
/**
 * `packages/granum/docs/SPEC.md` — нормативная часть ТЗ, которая уезжает в
 * опубликованный пакет: контракт провайдера, сборка провайдера, манифест,
 * резолвер, движок и таблица ошибок.
 *
 * Документ порождается из `docs/spec.md`, а не пишется руками, потому что
 * иначе он расходится молча: правка требования в ТЗ не видна в пакете, и
 * потребитель читает устаревшую норму. Так и случилось с R-6 — медленный путь
 * для объектной формы провайдера появился в ТЗ и в коде, а в пакетном SPEC
 * осталась прежняя формулировка.
 *
 *   node scripts/generate-spec.mjs           # перезаписать
 *   node scripts/generate-spec.mjs --check   # только сверить, код 1 при расхождении
 */
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const root = new URL('../', import.meta.url)
const sourcePath = fileURLToPath(new URL('docs/spec.md', root))
const targetPath = fileURLToPath(new URL('packages/granum/docs/SPEC.md', root))

const HEADER = `# \`@feugene/granum\` — спецификация

Нормативная часть [технического задания](../../docs/spec.md) пакета:
контракт провайдера, сборка провайдера, манифест, резолвер, движок и ошибки.
Слова **MUST / MUST NOT / SHOULD / MAY** — по RFC 2119. Полная версия с
целями, архитектурой, планом и критериями приёмки — в \`docs/\` репозитория;
инварианты — в [\`invariants.md\`](../../docs/invariants.md), формат манифеста —
в [\`manifest.md\`](../../docs/manifest.md).

`

/** Разделы ТЗ, входящие в нормативную часть: от заголовка до следующего (не включая). */
const SECTIONS = [
  ['## 5. Контракт провайдера', '## 10. Плагин приложения'],
  ['## 14. Ошибки', '## 15. Совместимость'],
  // Обещание стабильности читает потребитель, а у него есть только пакетный SPEC.
  ['## 18. Стабильность контракта', null],
]

function section(text, start, end) {
  const from = text.indexOf(start)
  // `null` вместо конца — секция до конца файла.
  const to = end === null ? text.length : text.indexOf(end, from)
  if (from < 0 || to < 0)
    throw new Error(`в docs/spec.md нет раздела '${start}' … '${end}' — поправьте SECTIONS в scripts/generate-spec.mjs`)
  return text.slice(from, to)
}

const source = readFileSync(sourcePath, 'utf8')
// Ссылки внутри `docs/` ведут на соседей; из пакета путь другой.
const RELINK = [
  [/\(\.\/manifest\.md\)/g, '(../../docs/manifest.md)'],
  [/\(\.\/invariants\.md\)/g, '(../../docs/invariants.md)'],
  [/\(\.\/decisions\.md\)/g, '(../../docs/decisions.md)'],
  [/\(\.\/plan\.md\)/g, '(../../docs/plan.md)'],
]
let body = SECTIONS.map(([start, end]) => section(source, start, end)).join('\n')
for (const [pattern, replacement] of RELINK)
  body = body.replace(pattern, replacement)

const expected = `${HEADER}${body.trimEnd()}\n`
const actual = readFileSync(targetPath, 'utf8')

if (process.argv.includes('--check')) {
  if (actual === expected) {
    process.stdout.write('spec: packages/granum/docs/SPEC.md совпадает с docs/spec.md\n')
  }
  else {
    process.stderr.write(
      'spec: packages/granum/docs/SPEC.md разошёлся с docs/spec.md.\n'
      + 'Нормативную часть правят в docs/spec.md, затем `yarn generate:spec`.\n',
    )
    process.exitCode = 1
  }
}
else {
  writeFileSync(targetPath, expected, 'utf8')
  process.stdout.write(`spec: ${actual === expected ? 'без изменений' : 'обновлён'} packages/granum/docs/SPEC.md\n`)
}
