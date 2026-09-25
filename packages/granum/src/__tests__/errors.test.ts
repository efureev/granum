import { describe, expect, it } from 'vitest'
import * as errors from '../core/errors'

/**
 * INV-ERR-2: каждая ошибка ядра — класс с `code`, наследующий `GranumError`,
 * с `name`, равным имени класса.
 */
describe('иерархия ошибок', () => {
  type ErrorCtor = new (...args: unknown[]) => errors.GranumError
  const classes = (Object.entries(errors) as [string, unknown][])
    .filter(([name, value]) => typeof value === 'function' && name.endsWith('Error') && name !== 'GranumError')
    .map(([name, value]) => [name, value as ErrorCtor] as const)

  it('экспортирует классы ошибок', () => {
    expect(classes.map(([name]) => name).sort()).toEqual([
      'CircularDependencyError',
      'CircularProviderDependencyError',
      'ComponentNotFoundError',
      'DuplicateComponentNameError',
      'DuplicateProviderIdError',
      'InvalidComponentKeyError',
      'InvalidComponentNameError',
      'InvalidProviderError',
      'InvalidTokenKeyError',
      'ProviderNotRegisteredError',
      'UnresolvedProviderDependencyError',
      'UnsupportedContractVersionError',
    ])
  })

  it.each([
    ['CircularDependencyError', [['a', 'b', 'a']]],
    ['CircularProviderDependencyError', [['a', 'b', 'a']]],
    ['ComponentNotFoundError', ['p', 'X', ['A', 'B'], 'ref']],
    ['DuplicateComponentNameError', ['p', 'X']],
    ['DuplicateProviderIdError', ['p', ['a', 'p']]],
    ['InvalidComponentKeyError', ['bad']],
    ['InvalidComponentNameError', ['p', 'bad name']],
    ['InvalidProviderError', ['p', 'invalid-id', 'details', 'X']],
    ['InvalidTokenKeyError', ['p', '--x', 'light']],
    ['ProviderNotRegisteredError', ['p', 'ref']],
    ['UnresolvedProviderDependencyError', ['p', 'from']],
    ['UnsupportedContractVersionError', ['p', 2, 1]],
  ] as const)('%s: GranumError с code и name', (name, args) => {
    const Ctor = errors[name] as unknown as ErrorCtor
    const e = new Ctor(...(args as unknown as unknown[]))
    expect(e).toBeInstanceOf(errors.GranumError)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe(name)
    expect(e.code).toMatch(/^[a-z][a-z-]+$/)
    expect(e.message.length).toBeGreaterThan(10)
  })

  it('коды уникальны', () => {
    const codes = classes.map(([, Ctor]) => {
      try {
        return new Ctor('p', 'x', ['a'], 'r').code
      }
      catch {
        return new Ctor(['a']).code
      }
    })
    expect(new Set(codes).size).toBe(codes.length)
  })
})
