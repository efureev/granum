#!/usr/bin/env node
/**
 * Детерминизм сборки провайдера (INV-DET-1, AC-6): манифест после повторной
 * сборки каждой фикстуры побайтно равен предыдущему. Запускать после
 * `yarn build:fixtures`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const base = join(root, 'fixtures')
const problems = []

for (const entry of readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const dir = join(base, entry.name)
  const manifest = join(dir, 'dist', 'granum.manifest.json')
  if (!existsSync(manifest)) {
    problems.push(`${entry.name}: нет манифеста — сначала yarn build:fixtures`)
    continue
  }
  const before = readFileSync(manifest, 'utf8')
  const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
  const result = spawnSync('yarn', ['-s', 'workspace', name, 'build'], { cwd: root, stdio: 'pipe', env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' } })
  if (result.status !== 0) {
    problems.push(`${entry.name}: повторная сборка упала\n${result.stderr.toString().slice(-800)}`)
    continue
  }
  const after = readFileSync(manifest, 'utf8')
  if (before !== after)
    problems.push(`${entry.name}: манифест изменился при повторной сборке`)
  else
    console.log(`check-determinism: ${name} — манифест стабилен`)
}

if (problems.length > 0) {
  console.error(`check-determinism: нарушения:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
