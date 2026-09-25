import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebug, isDebugEnabled } from '../core/debug'

const original = process.env.DEBUG

afterEach(() => {
  if (original === undefined)
    delete process.env.DEBUG
  else
    process.env.DEBUG = original
  vi.restoreAllMocks()
})

describe('createDebug', () => {
  it('выключен по умолчанию; включается по namespace, wildcard и *', () => {
    delete process.env.DEBUG
    expect(isDebugEnabled('granum:resolve')).toBe(false)
    process.env.DEBUG = 'granum:resolve'
    expect(isDebugEnabled('granum:resolve')).toBe(true)
    expect(isDebugEnabled('granum:scan')).toBe(false)
    process.env.DEBUG = 'granum:*'
    expect(isDebugEnabled('granum:scan')).toBe(true)
    process.env.DEBUG = '*'
    expect(isDebugEnabled('anything')).toBe(true)
  })

  it('логирует в stderr только когда включён; DEBUG разбирается при создании', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    delete process.env.DEBUG
    const frozen = createDebug('granum:resolve')
    frozen('hidden')
    process.env.DEBUG = 'granum:*'
    frozen('still hidden')
    expect(spy).not.toHaveBeenCalled()
    createDebug('granum:resolve')('shown')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('granum:resolve shown'))
  })
})
