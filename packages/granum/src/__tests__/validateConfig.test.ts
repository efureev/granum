import type { GranumConfig } from '../config'
import { describe, expect, it } from 'vitest'
import { defineGranumConfig } from '../config'
import { InvalidConfigError, validateGranumConfig } from '../vite/validateConfig'
import { testEngine } from './testEngine'

/** Валидный движок для форм, где проверяется не он. */
const engine = testEngine()

/** Конфиг со всеми полями всех уровней: список допустимых ключей не должен отставать от типа. */
const FULL: GranumConfig = {
  providers: ['@x/a'],
  components: 'imports',
  engine,
  theme: {
    id: 'brand',
    title: 'Brand',
    description: 'Своя тема приложения',
    docs: 'https://example.com/brand',
    root: { 'p-radius': '4px' },
    modes: { light: { colorScheme: 'light', tokens: { 'p-bg': '#fff' }, fallbacks: [{ supports: 'not (color: oklch(0 0 0))', tokens: { 'p-bg': 'white' } }] } },
    defaultMode: 'light',
    baseCss: ['@font-face { font-family: Brand; src: url(b.woff2) }'],
    extensions: { granularity: { componentDefaults: {} } },
    extends: 'slate',
    sources: ['src/theme'],
  },
  previews: ['clay', '@x/a:slate'],
  modes: {
    names: ['light', 'ocean', 'crimson', 'ruby'],
    define: {
      ocean: { extends: 'light', tokens: { 'p-bg': '#000' }, title: 'Ocean', colorScheme: 'dark' },
      crimson: { extends: 'ocean', tokensRef: { url: './crimson.css', selector: ':root', strict: false } },
      ruby: { extends: 'light', tokensRef: './ruby.css' },
    },
    activation: { attribute: 'data-theme', value: '{theme}-{mode}' },
    tokenOverrides: { root: { 'p-radius': '2px' }, light: { 'p-bg': '#111' } },
    strictTokens: true,
    system: 'media',
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

describe('validateGranumConfig', () => {
  it('валидные формы проходят', () => {
    expect(() => validateGranumConfig({ providers: ['@x/a'], engine })).not.toThrow()
    expect(() => validateGranumConfig(FULL)).not.toThrow()
  })

  it('не проверяются поля инстанса движка, объектов провайдеров и ключи override режима', () => {
    const provider = { id: '@x/obj', contractVersion: 1, components: [], anything: true }
    expect(failureOf({ ...FULL, engine: { ...engine, customField: 1 }, providers: [provider] })).toBeUndefined()
  })

  it.each([
    [null, ''],
    [{}, 'providers'],
    [{ providers: [] }, 'providers'],
    [{ providers: [''] }, 'providers.0'],
    // Движок обязателен и только инстансом: ни строки, ни объекта опций.
    [{ providers: ['a'] }, 'engine'],
    [{ providers: ['a'], engine: 'builtin' }, 'engine'],
    [{ providers: ['a'], engine: { extraRules: false } }, 'engine.extract'],
    [{ providers: ['a'], engine: { ...engine, name: '' } }, 'engine.name'],
    [{ providers: ['a'], engine: { ...engine, dialect: 'preset-mini' } }, 'engine.dialect'],
    [{ providers: ['a'], engine: { ...engine, vocabulary: '' } }, 'engine.vocabulary'],
    [{ providers: ['a'], engine, components: 42 }, 'components'],
    [{ providers: ['a'], engine, components: 'imports' }, 'components'],
    [{ providers: ['a'], engine, modes: { names: 'light' } }, 'modes.names'],
    // Имена токенов — без `--`: ключ с ним дал бы в CSS `----имя`.
    [{ providers: ['a'], engine, modes: { tokenOverrides: { dark: { '--p-primary': '#000' } } } }, 'modes.tokenOverrides.dark'],
    [{ providers: ['a'], engine, modes: { tokenOverrides: { dark: { '.dark': { 'p-primary': '#000' } } } } }, 'modes.tokenOverrides.dark..dark'],
    [{ providers: ['a'], engine, modes: { tokenOverrides: { dark: '#000' } } }, 'modes.tokenOverrides.dark'],
    [{ providers: ['a'], engine, modes: { define: { ocean: { extends: 'dark', tokens: { '--p-bg': '#000' } } } } }, 'modes.define.ocean.tokens'],
    [{ providers: ['a'], engine, modes: { define: { ocean: 'dark' } } }, 'modes.define.ocean'],
    [{ providers: ['a'], engine, modes: { define: { ocean: { tokens: {} } } } }, 'modes.define.ocean.extends'],
    // Имя режима — slug без дефиса: оно конец пары `<тема>-<режим>`.
    [{ providers: ['a'], engine, modes: { define: { 'deep-sea': { extends: 'dark' } } } }, 'modes.define.deep-sea'],
    [{ providers: ['a'], engine, modes: { system: 'auto' } }, 'modes.system'],
    [{ providers: ['a'], engine, modes: { activation: { attribute: '1x' } } }, 'modes.activation.attribute'],
    // Тема-объект — полные данные: C-24…C-26 с путём до поля.
    [{ providers: ['a'], engine, theme: '' }, 'theme'],
    [{ providers: ['a'], engine, theme: { id: 'Brand', title: 'B', root: {}, modes: { light: { colorScheme: 'light', tokens: {} } } } }, 'theme.id'],
    [{ providers: ['a'], engine, theme: { id: 'brand', title: 'B', root: {}, modes: { dark: { colorScheme: 'dark', tokens: {} } } } }, 'theme.modes'],
    [{ providers: ['a'], engine, theme: { id: 'brand', title: 'B', root: { '--x': '1' }, modes: { light: { colorScheme: 'light', tokens: {} } } } }, 'theme.root'],
    [{ providers: ['a'], engine, previews: 'clay' }, 'previews'],
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
    [{ modes: { define: { ocean: { extends: 'light', extend: 'light' } } } }, 'modes.define.ocean.extend', /did you mean 'extends'/],
    [{ modes: { define: { ocean: { extends: 'light', tokensRef: { uri: './o.css' } } } } }, 'modes.define.ocean.tokensRef.uri', /did you mean 'url'/],
    [{ css: { splitt: true } }, 'css.splitt', /did you mean 'split'/],
    [{ appSources: { dir: ['src'] } }, 'appSources.dir', /did you mean 'dirs'/],
    [{ report: { brotly: true } }, 'report.brotly', /did you mean 'brotli'/],
    [{ pruneTokens: { keeps: ['x'] } }, 'pruneTokens.keeps', /did you mean 'keep'/],
    [{ js: { gaurd: 'warn' } }, 'js.gaurd', /did you mean 'guard'/],
    [{ modes: { strictToken: true } }, 'modes.strictToken', /did you mean 'strictTokens'/],
    [{ theme: { id: 'b', title: 'B', root: {}, modes: { light: { colorScheme: 'light', tokens: {} } }, source: [] } }, 'theme.source', /did you mean 'sources'/],
    // Ключи пресета v1: подсказка, куда они делись.
    [{ scan: { dirs: ['src'] } }, 'scan', /provider manifests.*appSources/],
    [{ content: { filesystem: ['src/**'] } }, 'content', /provider manifests.*appSources/],
    [{ unocss: { rules: [] } }, 'unocss', /engine factory/],
    [{ rules: [] }, 'rules', /engine factory/],
    // Ключи `themes.*` granum 2: каждый — со своим новым местом (A-30).
    [{ themes: { names: ['light', 'dark'] } }, 'themes.names', /use 'modes\.names'/],
    [{ themes: { define: { ocean: { extends: 'dark' } } } }, 'themes.define', /use 'modes\.define'/],
    [{ themes: { tokenOverrides: { dark: {} } } }, 'themes.tokenOverrides', /use 'modes\.tokenOverrides'/],
    [{ themes: { strictTokens: true } }, 'themes.strictTokens', /use 'modes\.strictTokens'/],
    [{ themes: { themeFiles: {} } }, 'themes', /one theme \('theme'\) and its modes \('modes'\)/],
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
    [{ modes: { define: { crimson: { extends: 'light', tokensRef: 42 } } } }, 'modes.define.crimson.tokensRef'],
    [{ modes: 'dark' }, 'modes'],
  ])('%j — не объект → %s', (extra, path) => {
    const error = failureOf({ providers: ['@x/a'], engine, ...extra })
    expect(error?.path).toBe(path)
  })

  it('`defineGranumConfig` ловит лишний ключ типами', () => {
    // @ts-expect-error опечатка: `appSource` вместо `appSources`
    defineGranumConfig({ engine, providers: ['@x/a'], appSource: { dirs: ['src'] } })
    // @ts-expect-error ключ granum 2 — в 3 его место занял `modes`
    defineGranumConfig({ engine, providers: ['@x/a'], themes: { names: ['light'] } })
    expect(defineGranumConfig(FULL)).toBe(FULL)
  })
})
