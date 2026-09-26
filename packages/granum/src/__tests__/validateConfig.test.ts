import { describe, expect, it } from 'vitest'
import { InvalidConfigError, validateGranumConfig } from '../vite/validateConfig'
import { testEngine } from './testEngine'

/** Валидный движок для форм, где проверяется не он (A-E1). */
const engine = testEngine()

describe('validateGranumConfig (A-1)', () => {
  it('валидные формы проходят', () => {
    expect(() => validateGranumConfig({ providers: ['@x/a'], engine })).not.toThrow()
    expect(() => validateGranumConfig({ providers: ['@x/a'], engine, components: 'imports', appSources: { dirs: ['src'] }, themes: { names: ['light'] }, pruneTokens: { mode: 'on' }, js: { guard: 'warn' }, css: { layerPrefix: 'ds' } })).not.toThrow()
  })

  it.each([
    [null, ''],
    [{}, 'providers'],
    [{ providers: [] }, 'providers'],
    [{ providers: [''] }, 'providers.0'],
    // Движок обязателен и только инстансом (A-E2): ни строки, ни объекта опций.
    [{ providers: ['a'] }, 'engine'],
    [{ providers: ['a'], engine: 'builtin' }, 'engine'],
    [{ providers: ['a'], engine: { extraRules: false } }, 'engine.extract'],
    [{ providers: ['a'], engine: { ...engine, name: '' } }, 'engine.name'],
    [{ providers: ['a'], engine: { ...engine, dialect: 'preset-mini' } }, 'engine.dialect'],
    [{ providers: ['a'], engine: { ...engine, vocabulary: '' } }, 'engine.vocabulary'],
    [{ providers: ['a'], engine, components: 42 }, 'components'],
    [{ providers: ['a'], engine, components: 'imports' }, 'components'],
    [{ providers: ['a'], engine, themes: { names: 'light' } }, 'themes.names'],
    [{ providers: ['a'], engine, pruneTokens: { mode: 'maybe' } }, 'pruneTokens.mode'],
    [{ providers: ['a'], engine, appSources: { dirs: 'src' } }, 'appSources'],
    [{ providers: ['a'], engine, js: { guard: 'loud' } }, 'js.guard'],
    [{ providers: ['a'], engine, css: { layerPrefix: '1x' } }, 'css.layerPrefix'],
  ])('%j → InvalidConfigError at %s', (config, path) => {
    try {
      validateGranumConfig(config)
      throw new Error('should have thrown')
    }
    catch (e) {
      expect(e).toBeInstanceOf(InvalidConfigError)
      expect((e as InvalidConfigError).path).toBe(path)
    }
  })
})
