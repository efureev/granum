import { describe, expect, it } from 'vitest'
import { InvalidConfigError, validateGranumConfig } from '../vite/validateConfig'

describe('validateGranumConfig (A-1)', () => {
  it('валидные формы проходят', () => {
    expect(() => validateGranumConfig({ providers: ['@x/a'] })).not.toThrow()
    expect(() => validateGranumConfig({ providers: ['@x/a'], components: 'imports', appSources: { dirs: ['src'] }, themes: { names: ['light'] }, pruneTokens: { mode: 'on' }, js: { guard: 'warn' }, css: { layerPrefix: 'ds' } })).not.toThrow()
  })

  it.each([
    [null, ''],
    [{}, 'providers'],
    [{ providers: [] }, 'providers'],
    [{ providers: [''] }, 'providers.0'],
    [{ providers: ['a'], components: 42 }, 'components'],
    [{ providers: ['a'], components: 'imports' }, 'components'],
    [{ providers: ['a'], themes: { names: 'light' } }, 'themes.names'],
    [{ providers: ['a'], pruneTokens: { mode: 'maybe' } }, 'pruneTokens.mode'],
    [{ providers: ['a'], appSources: { dirs: 'src' } }, 'appSources'],
    [{ providers: ['a'], js: { guard: 'loud' } }, 'js.guard'],
    [{ providers: ['a'], css: { layerPrefix: '1x' } }, 'css.layerPrefix'],
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
