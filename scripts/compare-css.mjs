#!/usr/bin/env node
/**
 * AC-2: множество CSS-правил стенда `bench-one` на granum равно множеству
 * правил того же стенда на пресете v1 (снапшот `apps/bench-one/v1-snapshot.css`).
 * Сравнение после нормализации: `{context, selector, declarations}`, без
 * порядка и без обёрток `@layer`. Допустимые расхождения перечислены в
 * `apps/bench-one/expected-compare.mjs` и сверяются в обе стороны: исчезнувшее
 * ожидаемое расхождение — такое же событие, как появившееся новое.
 *
 *   node scripts/compare-css.mjs                 # bench-one
 *   node scripts/compare-css.mjs --stand bench-one --snapshot path/to.css
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { collectCssRules, diffCssRules } from './lib/cssRules.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const named = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const stand = named('--stand', 'bench-one')
const dir = join(ROOT, 'apps', stand)
const snapshotPath = named('--snapshot', join(dir, 'v1-snapshot.css'))
const assetsDir = join(dir, 'dist', 'assets')
if (!existsSync(assetsDir)) {
  console.error(`compare-css: нет ${assetsDir} — сначала yarn build:all`)
  process.exit(1)
}
const built = readdirSync(assetsDir).filter(f => f.endsWith('.css')).map(f => readFileSync(join(assetsDir, f), 'utf8')).join('\n')
const snapshot = readFileSync(snapshotPath, 'utf8')

const diff = diffCssRules(collectCssRules(snapshot), collectCssRules(built))
const expectedFile = join(dir, 'expected-compare.mjs')
const expected = existsSync(expectedFile) ? (await import(pathToFileURL(expectedFile).href)).default : { onlyV1: [], onlyGranum: [], changed: [] }

const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
const failures = []
if (!same(diff.onlyLeft, expected.onlyV1))
  failures.push(`только в v1: получили ${JSON.stringify(diff.onlyLeft)}, ждали ${JSON.stringify(expected.onlyV1)}`)
if (!same(diff.onlyRight, expected.onlyGranum))
  failures.push(`только в granum: получили ${JSON.stringify(diff.onlyRight)}, ждали ${JSON.stringify(expected.onlyGranum)}`)
if (!same(diff.changed.map(c => c.key), expected.changed))
  failures.push(`разные объявления: получили ${JSON.stringify(diff.changed.map(c => c.key))}, ждали ${JSON.stringify(expected.changed)}`)

if (flag('--json')) {
  process.stdout.write(`${JSON.stringify({ stand, snapshot: snapshotPath, diff, failures }, null, 2)}\n`)
}
else {
  const lines = [`compare-css: ${stand} против ${snapshotPath.replace(ROOT, '')}`]
  lines.push(`  правил в v1: ${collectCssRules(snapshot).size}, в granum: ${collectCssRules(built).size}`)
  lines.push(`  только в v1 (${diff.onlyLeft.length}): ${diff.onlyLeft.join(', ') || '—'}`)
  lines.push(`  только в granum (${diff.onlyRight.length}): ${diff.onlyRight.join(', ') || '—'}`)
  for (const c of diff.changed)
    lines.push(`  ≠ ${c.key}\n      v1:     ${c.left.join('; ')}\n      granum: ${c.right.join('; ')}`)
  lines.push(failures.length ? `✗ расхождения с expected-compare.mjs:\n  - ${failures.join('\n  - ')}` : '✓ множества правил совпадают с точностью до ожидаемых расхождений')
  process.stdout.write(`${lines.join('\n')}\n`)
}
process.exitCode = failures.length ? 1 : 0
