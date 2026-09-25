import { describe, expect, it } from 'vitest'
import * as errors from '../core/errors'

/**
 * INV-ERR-2: каждая ошибка ядра — класс с `code`, наследующий `GranumError`,
 * с `name`, равным имени класса, и уникальным кодом.
 */
const INSTANCES: readonly (readonly [string, () => errors.GranumError])[] = [
  ['ApplyExpansionError', () => new errors.ApplyExpansionError('a.css', 'unmatched-class', 'detail')],
  ['BoundaryViolationError', () => new errors.BoundaryViolationError('p', [{ file: 'index.js', specifier: 'node:fs', kind: 'node-import' }])],
  ['CircularDependencyError', () => new errors.CircularDependencyError(['a', 'b', 'a'])],
  ['CircularProviderDependencyError', () => new errors.CircularProviderDependencyError(['a', 'b', 'a'])],
  ['ComponentNotFoundError', () => new errors.ComponentNotFoundError('p', 'X', ['A', 'B'], 'ref')],
  ['ComponentOutsideSelectionError', () => new errors.ComponentOutsideSelectionError('p:X', '/app/src/App.vue', ['p:A'])],
  ['CssReadError', () => new errors.CssReadError('p', 'theme', 'light', 'theme/light.css')],
  ['CssSourceError', () => new errors.CssSourceError('https://x/y.css', 'unsupported-protocol')],
  ['DuplicateComponentNameError', () => new errors.DuplicateComponentNameError('p', 'X')],
  ['DuplicateProviderIdError', () => new errors.DuplicateProviderIdError('p', ['a', 'p'])],
  ['GranumCodegenError', () => new errors.GranumCodegenError('missing-open-marker', 'a.ts has no marker', 'a.ts')],
  ['InvalidComponentKeyError', () => new errors.InvalidComponentKeyError('bad')],
  ['InvalidComponentNameError', () => new errors.InvalidComponentNameError('p', 'bad name')],
  ['InvalidManifestError', () => new errors.InvalidManifestError('schema', 'details', 'components.X.entry', 'f.json')],
  ['InvalidProviderError', () => new errors.InvalidProviderError('p', 'invalid-id', 'details', 'X')],
  ['InvalidTokenKeyError', () => new errors.InvalidTokenKeyError('p', '--x', 'light')],
  ['ManifestNotFoundError', () => new errors.ManifestNotFoundError('@x/pkg', '/app')],
  ['PackageExportsError', () => new errors.PackageExportsError('p', ['./granum.manifest.json'])],
  ['ProviderNotRegisteredError', () => new errors.ProviderNotRegisteredError('p', 'ref')],
  ['TokenParseError', () => new errors.TokenParseError('message text', 'src', 'no-tokens')],
  ['TokenRefError', () => new errors.TokenRefError('p', 'light', 'X', 'file:///x.css')],
  ['UndeclaredDependencyError', () => new errors.UndeclaredDependencyError('p', [['A', 'p:B']])],
  ['UnresolvedProviderDependencyError', () => new errors.UnresolvedProviderDependencyError('p', 'from')],
  ['UnsupportedContractVersionError', () => new errors.UnsupportedContractVersionError('p', 2, 1)],
  ['UnsupportedManifestVersionError', () => new errors.UnsupportedManifestVersionError(2, 1, 'f.json')],
]

describe('иерархия ошибок', () => {
  it('таблица покрывает все экспортированные классы ошибок', () => {
    const exported = Object.keys(errors).filter(name => name.endsWith('Error') && name !== 'GranumError').sort()
    expect(exported).toEqual(INSTANCES.map(([name]) => name))
  })

  it.each(INSTANCES)('%s: GranumError с code и name', (name, make) => {
    const e = make()
    expect(e).toBeInstanceOf(errors.GranumError)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe(name)
    expect(e.code).toMatch(/^[a-z][a-z-]+$/)
    expect(e.message.length).toBeGreaterThan(10)
  })

  it('коды уникальны', () => {
    const codes = INSTANCES.map(([, make]) => make().code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
