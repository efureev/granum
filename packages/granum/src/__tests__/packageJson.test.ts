import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Форма `package.json` — часть контракта пакета (ТЗ N-1, N-2, §4.2).
 * Проверка на `dist` живёт в `scripts/check-dist-boundary.mjs`; здесь — то,
 * что видно без сборки.
 */
interface PackageJson {
  name: string
  type: string
  sideEffects: boolean
  engines: { node: string }
  bin: Record<string, string>
  exports: Record<string, unknown>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  files: string[]
}

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as PackageJson

const ENTRIES = ['.', './contract', './engine', './build', './vite', './node', './runtime', './codegen'] as const

describe('package.json', () => {
  it('has no runtime dependencies and only vite as peer (N-1, INV-DEP-1)', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([])
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual(['vite'])
    expect(pkg.peerDependenciesMeta?.vite?.optional).toBe(true)
  })

  it('publishes exactly the eight entry points of the spec plus ./client and package.json (§4.2)', () => {
    expect(Object.keys(pkg.exports)).toEqual([...ENTRIES, './client', './package.json'])
    for (const key of ENTRIES) {
      const target = pkg.exports[key] as Record<string, string>
      expect(target.types, key).toMatch(/^\.\/dist\/types\/src\/.+\.d\.ts$/)
      expect(target.import, key).toMatch(/^\.\/dist\/[a-z]+\.js$/)
      expect(target.default, key).toBe(target.import)
    }

    // `./client` — объявления виртуальных модулей, и кода за ними нет: импортировать
    // его нечем и незачем, поэтому у точки только `types`.
    const client = pkg.exports['./client'] as Record<string, string>
    expect(client).toEqual({ types: './client.d.ts' })
    expect(pkg.files).toContain('client.d.ts')
  })

  it('is ESM-only, side-effect free, Node >= 22, with the granum bin (N-2)', () => {
    expect(pkg.type).toBe('module')
    expect(pkg.sideEffects).toBe(false)
    expect(pkg.engines.node).toBe('>=22')
    expect(pkg.bin).toEqual({ granum: './dist/bin.js' })
    expect(pkg.files).toContain('dist')
  })
})
