#!/usr/bin/env node
/**
 * Проверка границ пакета на СОБРАННОМ `dist` (ТЗ N-1, INV-DEP-1, INV-BND-1,
 * INV-BND-2):
 *
 *   1. `dependencies` пусты, `peerDependencies` — ровно `vite`;
 *   2. браузерные entry (`index`, `contract`, `engine`, `runtime`; INV-CON-10, INV-BND-1) и всё, что
 *      они импортируют относительными путями, не содержат `node:`-импортов,
 *      голых имён встроенных модулей Node и запрещённых пакетов;
 *   3. ни один файл `dist` не импортирует `unocss`, `@unocss/*`, `magic-string`,
 *      `css-tree` — рантайма UnoCSS в пакете быть не должно;
 *   4. в `dist` нет реализации движка: ни вендоренного кода апстрима, ни правил
 *      (INV-ENG-9). Движок живёт в `@feugene/granum-engine-mini`, и ядро не
 *      имеет права протащить его обратно ни копией, ни импортом.
 *
 * Использование: node scripts/check-dist-boundary.mjs   # 0 — чисто, 1 — нарушения
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { collectImportSpecifiers, isRelative } from './lib/importSpecifiers.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const pkgDir = join(root, 'packages/granum')
const dist = join(pkgDir, 'dist')

const BROWSER_ENTRIES = ['index.js', 'contract.js', 'engine.js', 'runtime.js']
const FORBIDDEN_EVERYWHERE = [/^unocss(?:\/|$)/, /^@unocss\//, /^magic-string$/, /^css-tree$/]
const NODE_BUILTINS = new Set(builtinModules)

const problems = []

function fail(message) {
  problems.push(message)
}

// 1. package.json -----------------------------------------------------------

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const deps = Object.keys(pkg.dependencies ?? {})
if (deps.length > 0)
  fail(`package.json: dependencies должны быть пусты, найдено: ${deps.join(', ')}`)
const peers = Object.keys(pkg.peerDependencies ?? {})
if (peers.join(',') !== 'vite')
  fail(`package.json: peerDependencies должны быть ровно ["vite"], найдено: [${peers.join(', ')}]`)

// 2–3. dist -----------------------------------------------------------------

if (!existsSync(dist)) {
  console.error(`check-dist-boundary: нет ${relative(root, dist)} — сначала \`yarn build\``)
  process.exit(1)
}

function listJs(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory())
      out.push(...listJs(full))
    else if (entry.name.endsWith('.js'))
      out.push(full)
  }
  return out.sort()
}

function isNodeOnly(specifier) {
  return specifier.startsWith('node:') || NODE_BUILTINS.has(specifier)
}

function walkBrowserEntry(entryFile) {
  const seen = new Set()
  const queue = [entryFile]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file))
      continue
    seen.add(file)
    if (!existsSync(file)) {
      fail(`${relative(root, file)}: файл отсутствует (импортирован из браузерного entry)`)
      continue
    }
    for (const spec of collectImportSpecifiers(readFileSync(file, 'utf8'))) {
      if (isRelative(spec)) {
        queue.push(resolve(dirname(file), spec))
        continue
      }
      if (isNodeOnly(spec))
        fail(`${relative(root, file)}: браузерный entry импортирует '${spec}' (INV-BND-1)`)
      if (FORBIDDEN_EVERYWHERE.some(re => re.test(spec)))
        fail(`${relative(root, file)}: запрещённый импорт '${spec}' (INV-BND-2)`)
    }
  }
  return seen
}

const browserFiles = new Set()
for (const entry of BROWSER_ENTRIES) {
  for (const file of walkBrowserEntry(join(dist, entry)))
    browserFiles.add(file)
}

for (const file of listJs(dist)) {
  if (browserFiles.has(file))
    continue
  for (const spec of collectImportSpecifiers(readFileSync(file, 'utf8'))) {
    if (!isRelative(spec) && FORBIDDEN_EVERYWHERE.some(re => re.test(spec)))
      fail(`${relative(root, file)}: запрещённый импорт '${spec}' (INV-DEP-1)`)
  }
}

// 4. в ядре нет реализации движка (INV-ENG-9, AC-E2) ----------------------

/*
 * Опознаётся по следам вендоренного апстрима в тексте: имена `createGenerator`,
 * `presetMini` и `defaultSplitRE` встречаются только в нём. Проверять размером
 * ненадёжно, а списком файлов — недостаточно: копия могла уехать под другим
 * именем в общий чанк.
 */
const ENGINE_MARKERS = [/\bcreateGenerator\b/, /\bpresetMini\b/, /\bdefaultSplitRE\b/, /@unocss-skip-arbitrary-brackets/]
for (const file of listJs(dist)) {
  const text = readFileSync(file, 'utf8')
  for (const marker of ENGINE_MARKERS) {
    if (marker.test(text))
      fail(`${relative(root, file)}: след реализации движка (${marker.source}) — ядро не содержит движка (INV-ENG-9)`)
  }
}
for (const spec of ['granum-engine-mini']) {
  for (const file of listJs(dist)) {
    if (collectImportSpecifiers(readFileSync(file, 'utf8')).some(s => s.includes(spec)))
      fail(`${relative(root, file)}: импорт '${spec}' — ядро не зависит от реализации движка (INV-ENG-9)`)
  }
}

if (problems.length === 0) {
  console.log(`check-dist-boundary: чисто — ${browserFiles.size} браузерных файлов, ${listJs(dist).length} всего`)
  process.exit(0)
}

console.error('check-dist-boundary: нарушения границ пакета:\n')
for (const p of problems)
  console.error(`  - ${p}`)
process.exit(1)
