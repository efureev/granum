#!/usr/bin/env node
/**
 * Детерминизм сборки: манифест и файлы тем (`dist/themes/**`) после повторной
 * сборки каждой фикстуры побайтно равны предыдущим; CSS и отчёт приложения
 * `bench-one` после повторной сборки — тоже. Запускать после `yarn build:all`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const base = join(root, 'fixtures')
const problems = []

/** Манифест и файлы тем пакета: путь → содержимое. Данные темы из исходника пишет сборка (C-43) — они тоже её выход. */
function providerOutput(dir) {
  const out = new Map([['granum.manifest.json', readFileSync(join(dir, 'dist', 'granum.manifest.json'), 'utf8')]])
  const walk = (at) => {
    if (!existsSync(at))
      return
    for (const item of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, item.name)
      if (item.isDirectory())
        walk(path)
      else
        out.set(relative(join(dir, 'dist'), path), readFileSync(path, 'utf8'))
    }
  }
  walk(join(dir, 'dist', 'themes'))
  return out
}

for (const entry of readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const dir = join(base, entry.name)
  // Не всякая фикстура — провайдер: `atoms-engine` это движок, `theme-tide-package`
  // — пакет темы, манифеста у них нет и быть не должно. Провайдер — тот, кто
  // экспортирует манифест, а не тот, у кого есть `verify`.
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (!pkg.scripts?.verify || pkg.exports?.['./granum.manifest.json'] === undefined)
    continue
  const manifest = join(dir, 'dist', 'granum.manifest.json')
  if (!existsSync(manifest)) {
    problems.push(`${entry.name}: нет манифеста — сначала yarn build:fixtures`)
    continue
  }
  const before = providerOutput(dir)
  const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
  const result = spawnSync('yarn', ['-s', 'workspace', name, 'build'], { cwd: root, stdio: 'pipe', env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' } })
  if (result.status !== 0) {
    problems.push(`${entry.name}: повторная сборка упала\n${result.stderr.toString().slice(-800)}`)
    continue
  }
  const after = providerOutput(dir)
  const changed = [...new Set([...before.keys(), ...after.keys()])].sort().filter(file => before.get(file) !== after.get(file))
  if (changed.length > 0)
    problems.push(`${entry.name}: при повторной сборке изменились ${changed.join(', ')}`)
  else
    console.log(`check-determinism: ${name} — манифест и ${before.size - 1} файл(ов) тем стабильны`)
}

// Приложение: CSS-ассеты и отчёт побайтно стабильны.
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
