/**
 * Реестр инвариантов docs/invariants.md: у каждого заполнена колонка
 * «Проверка», и она называет тест, скрипт проверки или файл ожиданий
 * фикстуры/стенда, который существует, — то есть проверка есть, а не только
 * обещана. Номер инварианта живёт в реестре, код ссылается на причину словами.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '../../../..')

function walk(dir: string, filter: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'vendor')
      continue
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      out.push(...walk(path, filter))
    else if (filter(name))
      out.push(path)
  }
  return out
}

describe('реестр инвариантов', () => {
  const registry = readFileSync(join(REPO, 'docs/invariants.md'), 'utf8')
  const rows = registry.split('\n').filter(line => /^\| INV-[A-Z]+-\d+ \|/.test(line))
  const ids = rows.map(line => line.split('|')[1]!.trim())

  it('реестр непуст и идентификаторы уникальны', () => {
    expect(ids.length).toBeGreaterThan(50)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('колонка «Проверка» заполнена у каждого инварианта', () => {
    const empty = rows.filter(line => (line.split('|')[5] ?? '').trim().length < 5).map(line => line.split('|')[1]!.trim())
    expect(empty).toEqual([])
  })

  it('колонка «Проверка» называет существующий тест, скрипт проверки или файл ожиданий', () => {
    const files = [
      ...walk(join(REPO, 'packages'), name => /\.test\.ts$/.test(name)),
      ...walk(join(REPO, 'scripts'), name => /\.mjs$/.test(name)),
      ...walk(join(REPO, 'fixtures'), name => /^expected.*\.mjs$/.test(name)),
      ...walk(join(REPO, 'apps'), name => /^expected.*\.mjs$/.test(name)),
    ]
    // Тест называют по имени файла, скрипт и ожидания — путём от корня.
    const known = new Set(files.flatMap(f => [relative(REPO, f), basename(f)]))
    const problems: string[] = []
    for (const line of rows) {
      const id = line.split('|')[1]!.trim()
      const named = [...(line.split('|')[5] ?? '').matchAll(/`([\w./-]+\.(?:test\.ts|mjs))`/g)].map(m => m[1]!)
      if (named.length === 0)
        problems.push(`${id}: no test, script or expectations file named`)
      for (const name of named.filter(n => !known.has(n)))
        problems.push(`${id}: ${name} not found`)
    }
    expect(problems).toEqual([])
  })
})
