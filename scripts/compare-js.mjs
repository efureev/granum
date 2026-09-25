#!/usr/bin/env node
/**
 * AC-3: JS-бандл `bench-one` побайтно равен бандлу того же приложения без
 * плагина granum (заглушка отдаёт пустой `virtual:granum.css`). Плагин не
 * переписывает код и не влияет на раскладку чанков (A-7, INV-JS-1, INV-JS-3).
 * Запускать после `yarn build:all`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const dir = join(root, 'apps', 'bench-one')
if (!existsSync(join(dir, 'dist', 'assets'))) {
  console.error('compare-js: нет apps/bench-one/dist — сначала yarn build:all')
  process.exit(1)
}
const result = spawnSync('yarn', ['-s', 'workspace', '@granum-apps/bench-one', 'build'], { cwd: root, stdio: 'pipe', env: { ...process.env, GRANUM_STUB: '1', VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' } })
if (result.status !== 0) {
  console.error(`compare-js: сборка без granum упала\n${result.stderr.toString().slice(-800)}`)
  process.exit(1)
}
const jsOf = out => readdirSync(join(dir, out, 'assets')).filter(f => f.endsWith('.js')).sort().map(f => ({ file: f, text: readFileSync(join(dir, out, 'assets', f), 'utf8') }))
const withGranum = jsOf('dist')
const without = jsOf('dist-nogranum')
rmSync(join(dir, 'dist-nogranum'), { recursive: true, force: true })

// Имя entry-чанка включает хэш, в который Vite подмешивает и CSS-ассет, —
// поэтому сравнивается содержимое в одном и том же порядке, а не имена.
const problems = []
const renamed = []
if (withGranum.length !== without.length)
  problems.push(`число JS-чанков: с granum ${withGranum.length}, без ${without.length}`)
for (const [i, a] of withGranum.entries()) {
  const b = without[i]
  if (!b)
    continue
  if (a.text !== b.text)
    problems.push(`содержимое ${a.file} (${b.file} без granum) отличается`)
  else if (a.file !== b.file)
    renamed.push(`${a.file} ↔ ${b.file}`)
}
if (problems.length) {
  console.error(`compare-js: JS-бандл зависит от плагина granum:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
console.log(`compare-js: ✓ ${withGranum.length} JS-чанков bench-one побайтно равны сборке без granum${renamed.length ? ` (хэш имени отличается у ${renamed.join(', ')} — в него подмешан CSS-ассет)` : ''}`)
