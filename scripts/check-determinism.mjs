#!/usr/bin/env node
/**
 * Детерминизм сборки (INV-DET-1, INV-DET-2, AC-6): манифест после повторной
 * сборки каждой фикстуры побайтно равен предыдущему; CSS и отчёт приложения
 * `bench-one` после повторной сборки — тоже. Запускать после `yarn build:all`.
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
  // Не всякая фикстура — провайдер: `atoms-engine` это движок, манифеста у него
  // нет и быть не должно. Отличаем по наличию скрипта `verify`, а не по имени.
  if (!JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts?.verify)
    continue
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

// Приложение: CSS-ассеты и отчёт побайтно стабильны (INV-DET-2).
{
  const dir = join(root, 'apps', 'bench-one')
  const snapshot = () => {
    const assets = join(dir, 'dist', 'assets')
    const css = readdirSync(assets).filter(f => f.endsWith('.css')).sort().map(f => `${f}\n${readFileSync(join(assets, f), 'utf8')}`).join('\n')
    return { css, report: readFileSync(join(dir, 'dist', 'granum-report.json'), 'utf8') }
  }
  if (!existsSync(join(dir, 'dist', 'granum-report.json'))) {
    problems.push('bench-one: нет dist/granum-report.json — сначала yarn build:all')
  }
  else {
    const before = snapshot()
    const result = spawnSync('yarn', ['-s', 'workspace', '@granum-apps/bench-one', 'build'], { cwd: root, stdio: 'pipe', env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' } })
    if (result.status !== 0) {
      problems.push(`bench-one: повторная сборка упала\n${result.stderr.toString().slice(-800)}`)
    }
    else {
      const after = snapshot()
      if (before.css !== after.css)
        problems.push('bench-one: CSS изменился при повторной сборке')
      if (before.report !== after.report)
        problems.push('bench-one: granum-report.json изменился при повторной сборке')
      if (before.css === after.css && before.report === after.report)
        console.log('check-determinism: @granum-apps/bench-one — CSS и отчёт стабильны')
    }
  }
}

if (problems.length > 0) {
  console.error(`check-determinism: нарушения:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
