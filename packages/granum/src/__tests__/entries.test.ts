import { describe, expect, it } from 'vitest'
import * as build from '../build'
import * as codegen from '../codegen'
import { GRANUM_CONTRACT_VERSION } from '../contract/index'
import * as engine from '../engine/index'
import * as root from '../index'
import * as node from '../node'
import * as runtime from '../runtime'
import { GRANUM_VERSION } from '../version'
import * as vite from '../vite'

/** Каждая точка входа отдаёт свой публичный API (ТЗ §4.2). */
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
  })

  it('engine, build, vite, node, runtime and codegen expose their APIs', () => {
    // Ядро отдаёт контракт и хелперы, но не реализацию движка (INV-ENG-9, AC-E2).
    expect(typeof engine.extractClasses).toBe('function')
    expect(typeof engine.vocabularyFingerprint).toBe('function')
    expect(typeof engine.parseDialect).toBe('function')
    expect(Object.keys(engine)).not.toContain('createEngine')
    expect(Object.keys(engine)).not.toContain('windEngine')
    expect(typeof build.granumProvider).toBe('function')
    expect(typeof vite.granum).toBe('function')
    expect(typeof vite.defineGranumConfig).toBe('function')
    expect(typeof node.readManifestSync).toBe('function')
    expect(typeof node.prepareApp).toBe('function')
    expect(typeof node.emitCss).toBe('function')
    expect(node.GRANUM_CONTRACT_VERSION).toBe(1)
    expect(typeof runtime.createThemeController).toBe('function')
    expect(typeof codegen.runRegistryCodegen).toBe('function')
  })
})
