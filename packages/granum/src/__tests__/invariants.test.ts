/**
 * AC-11: у каждого инварианта `INV-*` из docs/invariants.md заполнена колонка
 * «Проверка», и его идентификатор упомянут хотя бы в одном тесте, скрипте
 * проверки или файле ожиданий фикстур/приложений — то есть проверка
 * существует, а не только обещана.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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

describe('реестр инвариантов (AC-11)', () => {
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

  it('каждый идентификатор упомянут в тесте, скрипте проверки или ожиданиях', () => {
    const files = [
      ...walk(join(REPO, 'packages/granum/src'), name => /\.test\.ts$/.test(name)),
      ...walk(join(REPO, 'scripts'), name => /\.mjs$/.test(name)),
      ...walk(join(REPO, 'fixtures'), name => /^expected.*\.mjs$/.test(name)),
      ...walk(join(REPO, 'apps'), name => /^expected.*\.mjs$/.test(name)),
    ]
    const corpus = files.map(f => readFileSync(f, 'utf8')).join('\n')
    const unmentioned = ids.filter(id => !new RegExp(`${id}(?!\\d)`).test(corpus))
    expect(unmentioned).toEqual([])
  })
})
