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
  themes: [
    {
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
      default: true,
      modes: {
        names: ['light', 'ocean', 'crimson', 'ruby'],
        define: {
          ocean: { extends: 'light', tokens: { 'p-bg': '#000' }, title: 'Ocean', colorScheme: 'dark' },
          crimson: { extends: 'ocean', tokensRef: { url: './crimson.css', selector: ':root', strict: false } },
          ruby: { extends: 'light', tokensRef: './ruby.css' },
        },
        tokenOverrides: { root: { 'p-radius': '2px' }, light: { 'p-bg': '#111' } },
        strictTokens: true,
      },
    },
    { theme: 'clay', modes: ['light', 'dark'] },
    '@x/a:slate',
  ],
  activation: { attribute: 'data-theme', value: '{theme}-{mode}', system: 'media' },
  css: { layers: true, layerPrefix: 'ds', split: false },
  appSources: { dirs: ['src'], extensions: ['.vue'] },
  pruneTokens: { mode: 'on', keep: ['p-*', /^p-/], keepPrefixes: ['p-'] },
  js: { dts: 'src/granum.d.ts', guard: 'warn' },
  report: { file: false, brotli: true },
}

/** Запись темы с режимами — для случаев, где проверяются режимы. */
const withModes = (modes: unknown): unknown => ({ themes: [{ theme: 'slate', modes }] })

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
    [{ providers: ['a'], engine, ...withModes({ names: 'light' }) as object }, 'themes.0.modes.names'],
    [{ providers: ['a'], engine, ...withModes(['light', 1]) as object }, 'themes.0.modes'],
    // Имена токенов — без `--`: ключ с ним дал бы в CSS `----имя`.
    [{ providers: ['a'], engine, ...withModes({ tokenOverrides: { dark: { '--p-primary': '#000' } } }) as object }, 'themes.0.modes.tokenOverrides.dark'],
    [{ providers: ['a'], engine, ...withModes({ tokenOverrides: { dark: { '.dark': { 'p-primary': '#000' } } } }) as object }, 'themes.0.modes.tokenOverrides.dark..dark'],
    [{ providers: ['a'], engine, ...withModes({ tokenOverrides: { dark: '#000' } }) as object }, 'themes.0.modes.tokenOverrides.dark'],
    [{ providers: ['a'], engine, ...withModes({ define: { ocean: { extends: 'dark', tokens: { '--p-bg': '#000' } } } }) as object }, 'themes.0.modes.define.ocean.tokens'],
    [{ providers: ['a'], engine, ...withModes({ define: { ocean: 'dark' } }) as object }, 'themes.0.modes.define.ocean'],
    [{ providers: ['a'], engine, ...withModes({ define: { ocean: { extends: 'dark', fallbacks: {} } } }) as object }, 'themes.0.modes.define.ocean.fallbacks'],
    [{ providers: ['a'], engine, ...withModes({ define: { ocean: { extends: 'dark', fallbacks: [{ supports: 'x', tokens: { '--p-bg': '#000' } }] } } }) as object }, 'themes.0.modes.define.ocean.fallbacks.0.tokens'],
    [{ providers: ['a'], engine, ...withModes({ define: { ocean: { extends: 'dark', fallbacks: [{ tokens: {} }] } } }) as object }, 'themes.0.modes.define.ocean.fallbacks.0'],
    [{ providers: ['a'], engine, ...withModes({ define: { ocean: { tokens: {} } } }) as object }, 'themes.0.modes.define.ocean.extends'],
    // Имя режима — slug без дефиса: оно конец пары `<тема>-<режим>`.
    [{ providers: ['a'], engine, ...withModes({ define: { 'deep-sea': { extends: 'dark' } } }) as object }, 'themes.0.modes.define.deep-sea'],
    [{ providers: ['a'], engine, activation: { system: 'auto' } }, 'activation.system'],
    [{ providers: ['a'], engine, activation: { attribute: '1x' } }, 'activation.attribute'],
    // Тема-объект — полные данные: id, имена режимов, режим по умолчанию и `extends` режимов проверяются с путём до поля.
    [{ providers: ['a'], engine, themes: [''] }, 'themes.0'],
    [{ providers: ['a'], engine, themes: [{ id: 'Brand', title: 'B', root: {}, modes: { light: { colorScheme: 'light', tokens: {} } } }] }, 'themes.0.id'],
    [{ providers: ['a'], engine, themes: [{ theme: { id: 'brand', title: 'B', root: {}, modes: { dark: { colorScheme: 'dark', tokens: {} } } } }] }, 'themes.0.theme.modes'],
    [{ providers: ['a'], engine, themes: [{ id: 'brand', title: 'B', root: { '--x': '1' }, modes: { light: { colorScheme: 'light', tokens: {} } } }] }, 'themes.0.root'],
    // Список тем: не пустой, основная ровно одна, отметка — булева.
    [{ providers: ['a'], engine, themes: 'clay' }, 'themes'],
    [{ providers: ['a'], engine, themes: [] }, 'themes'],
    [{ providers: ['a'], engine, themes: ['slate', 'clay'] }, 'themes'],
    [{ providers: ['a'], engine, themes: [{ theme: 'slate', default: true }, { theme: 'clay', default: true }] }, 'themes'],
    [{ providers: ['a'], engine, themes: [{ theme: 'slate', default: 'yes' }] }, 'themes.0.default'],
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
    [withModes({ define: { ocean: { extends: 'light', extend: 'light' } } }), 'themes.0.modes.define.ocean.extend', /did you mean 'extends'/],
    [withModes({ define: { ocean: { extends: 'light', tokensRef: { uri: './o.css' } } } }), 'themes.0.modes.define.ocean.tokensRef.uri', /did you mean 'url'/],
    [{ css: { splitt: true } }, 'css.splitt', /did you mean 'split'/],
    [{ appSources: { dir: ['src'] } }, 'appSources.dir', /did you mean 'dirs'/],
    [{ report: { brotly: true } }, 'report.brotly', /did you mean 'brotli'/],
    [{ pruneTokens: { keeps: ['x'] } }, 'pruneTokens.keeps', /did you mean 'keep'/],
    [{ js: { gaurd: 'warn' } }, 'js.gaurd', /did you mean 'guard'/],
    [withModes({ strictToken: true }), 'themes.0.modes.strictToken', /did you mean 'strictTokens'/],
    [{ themes: [{ theme: 'slate', defualt: true }] }, 'themes.0.defualt', /did you mean 'default'/],
    [{ themes: [{ id: 'b', title: 'B', root: {}, modes: { light: { colorScheme: 'light', tokens: {} } }, source: [] }] }, 'themes.0.source', /did you mean 'sources'/],
    // Вложенные ключи темы-объекта: опечатка молча теряла бы фолбэки.
    [{ themes: [{ theme: { id: 'b', title: 'B', root: {}, modes: { light: { colorScheme: 'light', tokens: {}, fallback: [] } } } }] }, 'themes.0.theme.modes.light.fallback', /did you mean 'fallbacks'/],
    [{ themes: ['slate', { id: 'b', title: 'B', root: {}, modes: { light: { colorScheme: 'light', tokens: {}, fallbacks: [{ supports: 'x', tokens: {}, token: {} }] } } }] }, 'themes.1.modes.light.fallbacks.0.token', /did you mean 'tokens'/],
    // Ключи пресета v1: подсказка, куда они делись.
    [{ scan: { dirs: ['src'] } }, 'scan', /provider manifests.*appSources/],
    [{ content: { filesystem: ['src/**'] } }, 'content', /provider manifests.*appSources/],
    [{ unocss: { rules: [] } }, 'unocss', /engine factory/],
    [{ rules: [] }, 'rules', /engine factory/],
    // Ключи `themes.*` granum 2: каждый — со своим новым местом.
    [{ themes: { names: ['light', 'dark'] } }, 'themes.names', /use 'themes\[i\]\.modes\.names'/],
    [{ themes: { define: { ocean: { extends: 'dark' } } } }, 'themes.define', /use 'themes\[i\]\.modes\.define'/],
    [{ themes: { tokenOverrides: { dark: {} } } }, 'themes.tokenOverrides', /use 'themes\[i\]\.modes\.tokenOverrides'/],
    [{ themes: { strictTokens: true } }, 'themes.strictTokens', /use 'themes\[i\]\.modes\.strictTokens'/],
    [{ themes: { themeFiles: {} } }, 'themes', /expected an array/],
    // Ключи granum 3.0–3.7: куда переехали.
    [{ theme: 'clay' }, 'theme', /replaced in granum 3\.8.*themes/],
    [{ previews: ['clay'] }, 'previews', /replaced in granum 3\.8.*own sheet/],
    [{ modes: { names: ['light'] } }, 'modes', /moved in granum 3\.8.*'activation'/],
    [{ css: { previews: 'separate' } }, 'css.previews', /removed in granum 3\.8/],
    [{ pruneTokens: { appSources: ['src'] } }, 'pruneTokens.appSources', /top-level 'appSources'/],
    // Опции, удалённые в этом выпуске: почему их нет.
    [{ js: { virtualComponents: false } }, 'js.virtualComponents', /removed/],
    [{ css: { expandDirectives: true } }, 'css.expandDirectives', /removed/],
    [withModes({ define: { ocean: { extends: 'light', tokensRef: { url: './o.css', as: '.x' } } } }), 'themes.0.modes.define.ocean.tokensRef.as', /removed.*pair/],
    // Ничего похожего — перечень допустимых ключей уровня.
    [{ foo: 1 }, 'foo', /expected one of: providers, components/],
  ])('%j → %s', (extra, path, message) => {
    const error = failureOf({ providers: ['@x/a'], engine, ...extra as object })
    expect(error?.path).toBe(path)
    expect(error?.message).toMatch(message)
  })

  it.each([
    [{ css: 'x' }, 'css'],
    [{ js: 1 }, 'js'],
    [{ report: [] }, 'report'],
    [{ pruneTokens: 'on' }, 'pruneTokens'],
    [withModes({ define: { crimson: { extends: 'light', tokensRef: 42 } } }), 'themes.0.modes.define.crimson.tokensRef'],
    [withModes('dark'), 'themes.0.modes'],
    [{ activation: 'data-theme' }, 'activation'],
  ])('%j — не объект → %s', (extra, path) => {
    const error = failureOf({ providers: ['@x/a'], engine, ...extra as object })
    expect(error?.path).toBe(path)
  })

  it('`defineGranumConfig` ловит лишний ключ типами', () => {
    // @ts-expect-error опечатка: `appSource` вместо `appSources`
    defineGranumConfig({ engine, providers: ['@x/a'], appSource: { dirs: ['src'] } })
    // @ts-expect-error ключ granum 2 — `themes` теперь список тем сборки
    defineGranumConfig({ engine, providers: ['@x/a'], themes: { names: ['light'] } })
    // @ts-expect-error ключ granum 3.0–3.7 — тема сборки теперь в `themes`
    defineGranumConfig({ engine, providers: ['@x/a'], theme: 'slate' })
    expect(defineGranumConfig(FULL)).toBe(FULL)
  })
})
