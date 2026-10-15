import type { GranumConfig } from '../config'
import { describe, expect, it } from 'vitest'
import { defineGranumConfig } from '../config'
import { InvalidConfigError, validateGranumConfig } from '../vite/validateConfig'
import { testEngine } from './testEngine'

/** Валидный движок для форм, где проверяется не он (A-E1). */
const engine = testEngine()

/** Конфиг со всеми полями всех уровней: список допустимых ключей не должен отставать от типа. */
const FULL: GranumConfig = {
  providers: ['@x/a'],
  components: 'imports',
  engine,
  themes: {
    names: ['light', 'ocean', 'crimson', 'ruby'],
    define: {
      ocean: { extends: 'light', selector: '[data-theme="ocean"]', tokens: { 'p-bg': '#000' }, label: 'Ocean', colorScheme: 'dark' },
      crimson: { tokensRef: { url: './crimson.css', selector: ':root', as: '.crimson', strict: false } },
      ruby: { tokensRef: './ruby.css' },
    },
    tokenOverrides: { dark: { 'p-bg': '#111', '.dark': { 'p-fg': '#fff' } } },
    strictTokens: true,
  },
  css: { layers: true, layerPrefix: 'ds', split: false },
  appSources: { dirs: ['src'], extensions: ['.vue'] },
  pruneTokens: { mode: 'on', keep: ['p-*', /^p-/], keepPrefixes: ['p-'] },
  js: { dts: 'src/granum.d.ts', guard: 'warn' },
  report: { file: false, brotli: true },
}

/** Ошибка проверки или `undefined`, если конфиг прошёл. */
function failureOf(config: unknown): InvalidConfigError | undefined {
  try {
    validateGranumConfig(config)
    return undefined
  }
  catch (e) {
    expect(e).toBeInstanceOf(InvalidConfigError)
    return e as InvalidConfigError
  }
}

describe('validateGranumConfig (A-1)', () => {
  it('валидные формы проходят', () => {
    expect(() => validateGranumConfig({ providers: ['@x/a'], engine })).not.toThrow()
    expect(() => validateGranumConfig(FULL)).not.toThrow()
  })

  it('не проверяются поля инстанса движка, объектов провайдеров и ключи override темы', () => {
    const provider = { id: '@x/obj', contractVersion: 1, components: [], anything: true }
    expect(failureOf({ ...FULL, engine: { ...engine, customField: 1 }, providers: [provider] })).toBeUndefined()
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
    // Имена токенов — без `--`: ключ с ним дал бы в CSS `----имя`.
    [{ providers: ['a'], engine, themes: { tokenOverrides: { dark: { '--p-primary': '#000' } } } }, 'themes.tokenOverrides.dark'],
    [{ providers: ['a'], engine, themes: { tokenOverrides: { dark: { '.dark': { '--p-primary': '#000' } } } } }, 'themes.tokenOverrides.dark'],
    [{ providers: ['a'], engine, themes: { tokenOverrides: { dark: '#000' } } }, 'themes.tokenOverrides.dark'],
    [{ providers: ['a'], engine, themes: { define: { ocean: { tokens: { '--p-bg': '#000' } } } } }, 'themes.define.ocean.tokens'],
    [{ providers: ['a'], engine, themes: { define: { ocean: 'dark' } } }, 'themes.define.ocean'],
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

describe('неизвестный ключ конфига — ошибка с путём и подсказкой', () => {
  it.each([
    // Опечатки: ближайший допустимый ключ того же уровня.
    [{ appSource: { dirs: ['src'] } }, 'appSource', /did you mean 'appSources'/],
    [{ themes: { define: { ocean: { extend: 'light' } } } }, 'themes.define.ocean.extend', /did you mean 'extends'/],
    [{ themes: { define: { ocean: { tokensRef: { uri: './o.css' } } } } }, 'themes.define.ocean.tokensRef.uri', /did you mean 'url'/],
    [{ css: { splitt: true } }, 'css.splitt', /did you mean 'split'/],
    [{ appSources: { dir: ['src'] } }, 'appSources.dir', /did you mean 'dirs'/],
    [{ report: { brotly: true } }, 'report.brotly', /did you mean 'brotli'/],
    [{ pruneTokens: { keeps: ['x'] } }, 'pruneTokens.keeps', /did you mean 'keep'/],
    [{ js: { gaurd: 'warn' } }, 'js.gaurd', /did you mean 'guard'/],
    [{ themes: { strictToken: true } }, 'themes.strictToken', /did you mean 'strictTokens'/],
    // Ключи пресета v1: подсказка, куда они делись.
    [{ scan: { dirs: ['src'] } }, 'scan', /provider manifests.*appSources/],
    [{ content: { filesystem: ['src/**'] } }, 'content', /provider manifests.*appSources/],
    [{ unocss: { rules: [] } }, 'unocss', /engine factory/],
    [{ rules: [] }, 'rules', /engine factory/],
    [{ themes: { themeFiles: { dark: './dark.css' } } }, 'themes.themeFiles', /tokenOverrides.*tokensRef/],
    [{ themes: { baseFile: './base.css' } }, 'themes.baseFile', /tokenOverrides.*tokensRef/],
    [{ themes: { tokensFile: './tokens.css' } }, 'themes.tokensFile', /tokenOverrides.*tokensRef/],
    [{ pruneTokens: { appSources: ['src'] } }, 'pruneTokens.appSources', /top-level 'appSources'/],
    // Опции, удалённые в этом выпуске: почему их нет.
    [{ js: { virtualComponents: false } }, 'js.virtualComponents', /removed/],
    [{ css: { expandDirectives: true } }, 'css.expandDirectives', /removed/],
    // Ничего похожего — перечень допустимых ключей уровня.
    [{ foo: 1 }, 'foo', /expected one of: providers, components/],
  ])('%j → %s', (extra, path, message) => {
    const error = failureOf({ providers: ['@x/a'], engine, ...extra })
    expect(error?.path).toBe(path)
    expect(error?.message).toMatch(message)
  })

  it.each([
    [{ css: 'x' }, 'css'],
    [{ js: 1 }, 'js'],
    [{ report: [] }, 'report'],
    [{ pruneTokens: 'on' }, 'pruneTokens'],
    [{ themes: { define: { crimson: { tokensRef: 42 } } } }, 'themes.define.crimson.tokensRef'],
  ])('%j — не объект → %s', (extra, path) => {
    const error = failureOf({ providers: ['@x/a'], engine, ...extra })
    expect(error?.path).toBe(path)
  })

  it('`defineGranumConfig` ловит лишний ключ типами', () => {
    // @ts-expect-error опечатка: `appSource` вместо `appSources`
    defineGranumConfig({ engine, providers: ['@x/a'], appSource: { dirs: ['src'] } })
    // @ts-expect-error ключ пресета v1 — в granum его нет
    defineGranumConfig({ engine, providers: ['@x/a'], themes: { themeFiles: { dark: './dark.css' } } })
    expect(defineGranumConfig(FULL)).toBe(FULL)
  })
})
