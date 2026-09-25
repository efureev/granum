import { describe, expect, it } from 'vitest'
import { granumProvider } from '../build'
import { runRegistryCodegen } from '../codegen'
import { GRANUM_CONTRACT_VERSION } from '../contract/index'
import * as root from '../index'
import { GranumNotImplementedError } from '../internal/notImplemented'
import * as node from '../node'
import { createThemeController } from '../runtime'
import { GRANUM_VERSION } from '../version'
import { defineGranumConfig, granum } from '../vite'

/**
 * Каждая точка входа существует и честно сообщает, что ещё не реализована:
 * заглушка бросает `GranumNotImplementedError` с именем API и этапом, а не
 * возвращает `undefined`.
 */
describe('entry points', () => {
  it('contract exposes contract version 1 (C-2)', () => {
    expect(GRANUM_CONTRACT_VERSION).toBe(1)
    expect(root.GRANUM_CONTRACT_VERSION).toBe(1)
  })

  it('root re-exports the package version, contract helpers and the resolver', () => {
    expect(root.GRANUM_VERSION).toBe(GRANUM_VERSION)
    expect(GRANUM_VERSION).toBe('0.0.0-test')
    expect(typeof root.defineGranumProvider).toBe('function')
    expect(typeof root.defineGranumComponent).toBe('function')
    expect(typeof root.resolveGranum).toBe('function')
    expect(typeof root.GranumError).toBe('function')
    expect(typeof node.readManifestSync).toBe('function')
    expect(node.GRANUM_CONTRACT_VERSION).toBe(1)
  })

  it.each([
    ['granumProvider', 'stage 4', () => granumProvider()],
    ['runRegistryCodegen', 'stage 4', () => runRegistryCodegen()],
    ['granum', 'stage 5', () => granum()],
    ['defineGranumConfig', 'stage 5', () => defineGranumConfig()],
    ['createThemeController', 'stage 5', () => createThemeController()],
  ])('%s is a typed stub for %s', (api, stage, call) => {
    expect(call).toThrowError(GranumNotImplementedError)
    try {
      call()
    }
    catch (error) {
      const e = error as GranumNotImplementedError
      expect(e.api).toBe(api)
      expect(e.stage).toBe(stage)
      expect(e.code).toBe('not-implemented')
      expect(e.message).toContain(api)
    }
  })
})
