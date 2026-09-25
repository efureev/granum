#!/usr/bin/env node
/**
 * Запускает скрипт во всех воркспейсах каталога, у которых он объявлен:
 *
 *   node scripts/run-workspaces.mjs fixtures build
 *   node scripts/run-workspaces.mjs apps verify
 *
 * Порядок — по имени каталога, чтобы прогон был воспроизводим. Пустой каталог
 * или отсутствие скрипта у всех воркспейсов — не ошибка: так корневые команды
 * `build:all`, `verify:apps`, `sizes:check` остаются валидными с этапа 0, пока
 * фикстур и приложений ещё нет.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const [dir, script] = process.argv.slice(2)

if (!dir || !script) {
  console.error('usage: run-workspaces.mjs <dir> <script>')
  process.exit(2)
}

const base = join(root, dir)
const targets = existsSync(base)
  ? readdirSync(base, { withFileTypes: true })
      .filter(e => e.isDirectory() && existsSync(join(base, e.name, 'package.json')))
      .map(e => JSON.parse(readFileSync(join(base, e.name, 'package.json'), 'utf8')))
      .filter(pkg => pkg.scripts && pkg.scripts[script])
      .map(pkg => pkg.name)
      .sort()
  : []

if (targets.length === 0) {
  console.log(`run-workspaces: в ${dir}/ нет воркспейсов со скриптом "${script}" — пропуск`)
  process.exit(0)
}

for (const name of targets) {
  console.log(`\n▶ ${name}: ${script}`)
  const result = spawnSync('yarn', ['workspace', name, script], { stdio: 'inherit', cwd: root })
  if (result.status !== 0) {
    console.error(`run-workspaces: ${name} ${script} завершился с кодом ${result.status}`)
    process.exit(result.status ?? 1)
  }
}
