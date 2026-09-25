#!/usr/bin/env node
/**
 * Сверка собранного фикстурного провайдера с ожиданиями (AC-1, INV-MAN-5,
 * INV-MAN-6): читает `dist/granum.manifest.json` через читатель granum (то есть
 * проходит все проверки manifest.md §4) и прогоняет `expected-manifest.mjs`
 * фикстуры. Запускается из каталога фикстуры: `yarn workspace <name> verify`.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { createEngine } from '@feugene/granum/engine'
import { readManifestSync, scanTokenConsumption } from '@feugene/granum/node'
import { readFileSync } from 'node:fs'

const dir = process.cwd()
const manifestFile = join(dir, 'dist', 'granum.manifest.json')
if (!existsSync(manifestFile)) {
  console.error(`verify-fixture: нет ${manifestFile} — сначала \`yarn build\``)
  process.exit(1)
}

const loaded = readManifestSync(manifestFile)
const expected = await import(pathToFileURL(join(dir, 'expected-manifest.mjs')).href)
const problems = []
const check = (condition, message) => {
  if (!condition)
    problems.push(message)
}

// Round-trip (INV-MAN-5, INV-MAN-6): извлечение по файлам из dist даёт ровно
// то, что записано в манифесте — классы с правилом у движка и потребляемые токены.
const engine = createEngine()
for (const [name, component] of Object.entries(loaded.manifest.components)) {
  const candidates = new Set()
  const consumes = new Set()
  for (const file of component.files) {
    const code = readFileSync(join(dir, 'dist', file), 'utf8')
    for (const token of engine.extract(code, file))
      candidates.add(token)
    const scan = scanTokenConsumption(code, file)
    for (const t of scan.uses.keys())
      consumes.add(`--${t}`)
    for (const t of scan.literals)
      consumes.add(`--${t}`)
  }
  for (const file of component.css) {
    for (const t of scanTokenConsumption(readFileSync(join(dir, 'dist', file), 'utf8'), file).uses.keys())
      consumes.add(`--${t}`)
  }
  const matched = [...(await engine.generate({ classes: candidates })).matched.keys()].sort()
  check(matched.join(' ') === component.classes.join(' '), `${name}: classes round-trip — manifest [${component.classes}] vs dist [${matched}]`)
  const expectedConsumes = [...consumes].sort()
  check(expectedConsumes.join(' ') === component.tokens.consumes.join(' '), `${name}: consumes round-trip — manifest [${component.tokens.consumes}] vs dist [${expectedConsumes}]`)
  // INV-LAY-3: в браузерных чанках нет data:-URL на месте путей пакета.
  for (const file of component.files)
    check(!readFileSync(join(dir, 'dist', file), 'utf8').includes('data:text/css'), `${name}: ${file} contains a data:text/css URL`)
}

try {
  await expected.default({ manifest: loaded.manifest, baseUrl: loaded.baseUrl, distDir: join(dir, 'dist'), assert, check })
}
catch (error) {
  problems.push(error instanceof Error ? error.message : String(error))
}

if (problems.length > 0) {
  console.error(`verify-fixture: ${loaded.manifest.id} — расхождения:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
console.log(`verify-fixture: ${loaded.manifest.id} — ok (${Object.keys(loaded.manifest.components).length} components)`)
