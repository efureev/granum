import type { GranumProvider } from '../contract'
import type { PreparedApp } from '../node/prepare'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CssReadError } from '../core/errors'
import { resolveTokenValue } from '../core/resolve'
import { emitCss } from '../node/emit'
import { getThemeManifest } from '../node/themeManifest'
import { createThemeController } from '../runtime'
import { fileThemeProvider, prepareTestApp } from './helpers'

/**
 * Тема, которую провайдер поставил файлом (так устроено ядро granularity):
 * `define` и `tokenOverrides` приложения обязаны действовать на неё каскадом —
 * у приложения приоритет над пакетом. Блок приложения встаёт под селектор файла
 * и идёт в слое `themes` после файла своей темы, но раньше файлов следующих тем.
 */

/** Позиция первого вхождения в слое `themes`; −1 — нет. */
async function themesLayer(app: PreparedApp): Promise<{ css: string, at: (s: string) => number }> {
  const css = (await emitCss(app)).layers.themes
  return { css, at: (s: string) => css.indexOf(s) }
}

/** Текст блока, в котором стоит объявление: от предыдущей `}` до него. */
function blockOf(css: string, declaration: string): string {
  const at = css.indexOf(declaration)
  return css.slice(css.lastIndexOf('}', at) + 1, at).trim()
}

describe('tokenOverrides к теме-файлу', () => {
  it('override тёмной темы — под селектором её файла и после файла', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], tokenOverrides: { dark: { 'p-primary': '#4fd1e0' } } } }, root)
    const { css, at } = await themesLayer(app)
    expect(blockOf(css, '--p-primary: #4fd1e0')).toMatch(/^\[data-theme='dark'\], \.dark \{/)
    expect(at('--p-primary: #4fd1e0')).toBeGreaterThan(at('--p-primary: #60a5fa'))
    expect((await emitCss(app)).layers.tokens).not.toContain('#4fd1e0')
    // Диагностика и каскад сходятся: значение, которое называет отчёт, действует.
    expect(resolveTokenValue(app.resolution, 'dark', 'p-primary')).toBe('#4fd1e0')
    expect(app.resolution.warnings).toEqual([])
  })

  it('override светлой темы — после её файла, но раньше файла тёмной', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], tokenOverrides: { light: { 'p-bg': '#fafafa' } } } }, root)
    const { css, at } = await themesLayer(app)
    expect(blockOf(css, '--p-bg: #fafafa')).toMatch(/^:root, \[data-theme='light'\], \.light \{/)
    expect(at('--p-bg: #fafafa')).toBeGreaterThan(at('--p-bg: #ffffff'))
    // `:root` светлой темы совпадает с <html> и под тёмной: блок после файла
    // тёмной перебил бы её значения.
    expect(at('--p-bg: #fafafa')).toBeLessThan(at('--p-bg: #0f172a'))
  })

  it('`define` темы-файла без `extends` ложится туда же, где override', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], define: { dark: { tokens: { 'p-bg': '#062b32' } } } } }, root)
    const { css, at } = await themesLayer(app)
    expect(blockOf(css, '--p-bg: #062b32')).toMatch(/^\[data-theme='dark'\], \.dark \{/)
    expect(at('--p-bg: #062b32')).toBeGreaterThan(at('--p-bg: #0f172a'))
  })

  it('структурный блок компонента идёт после файла своей темы', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Tinted'], themes: { names: ['light', 'dark'] } }, root)
    const { at } = await themesLayer(app)
    expect(at('--p-tint: #334155')).toBeGreaterThan(at('--p-primary: #60a5fa'))
  })

  it('блок компонента под атрибутом не уводит override с селектора файла', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Tinted'], themes: { names: ['light', 'dark'], tokenOverrides: { dark: { 'p-primary': '#4fd1e0' } }, define: { dark: { tokens: { 'p-bg': '#062b32' } } } } }, root)
    const { css } = await themesLayer(app)
    // Под `[data-theme="dark"]` значение не действовало бы при активации классом `.dark`.
    expect(blockOf(css, '--p-primary: #4fd1e0')).toMatch(/^\[data-theme='dark'\], \.dark \{/)
    expect(blockOf(css, '--p-bg: #062b32')).toMatch(/^\[data-theme='dark'\], \.dark \{/)
    expect(blockOf(css, '--p-tint: #334155')).toMatch(/^\[data-theme="dark"\] \{/)
  })

  it('блок компонента без селектора у темы-файла — под селектором файла, а не `:root`', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Bare'], themes: { names: ['light', 'dark'] } }, root)
    const { css, at } = await themesLayer(app)
    expect(blockOf(css, '--p-shade: #020617')).toMatch(/^\[data-theme='dark'\], \.dark \{/)
    expect(at('--p-shade: #020617')).toBeGreaterThan(at('--p-primary: #60a5fa'))
    expect((await emitCss(app)).layers.tokens).not.toContain('p-shade')
  })

  it('`strictTokens` держит токен, объявленный файлом темы, и отбрасывает чужой', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], strictTokens: true, tokenOverrides: { dark: { 'p-primary': '#4fd1e0', 'p-unknown': '#000' } } } }, root)
    expect(app.resolution.warnings).toEqual([{ kind: 'override-skipped', theme: 'dark', token: 'p-unknown' }])
    expect((await emitCss(app)).layers.themes).toContain('--p-primary: #4fd1e0')
  })

  it('override не меняет активацию темы: тёмная остаётся на атрибуте, а не `root`', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], tokenOverrides: { dark: { 'p-primary': '#4fd1e0' } } } }, root)
    const dark = getThemeManifest(app.resolution).themes.find(t => t.name === 'dark')
    expect(dark?.activation.type).not.toBe('root')
  })
})

describe('`define` поверх темы-файла', () => {
  it('`tokensRef` перекрашивает тему-файл целиком: под селектором файла, после него', async () => {
    const { root, provider } = fileThemeProvider()
    writeFileSync(join(root, 'light.css'), ':root {\n  --p-bg: #fdf6e3;\n  --p-primary: #b58900;\n}\n')
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], define: { light: { tokensRef: './light.css' } } } }, root)
    const { css, at } = await themesLayer(app)
    expect(css).toContain(`:root, [data-theme='light'], .light {\n  --p-bg: #fdf6e3;\n  --p-primary: #b58900;\n}`)
    expect(at('--p-bg: #fdf6e3')).toBeGreaterThan(at('--p-bg: #ffffff'))
    expect(at('--p-bg: #fdf6e3')).toBeLessThan(at('--p-bg: #0f172a'))
  })

  it('`extends` без `selector` у темы-файла — под селектором файла, а не `[data-theme]` по имени', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Tinted'], themes: { names: ['light', 'dark'], define: { dark: { extends: 'light', tokens: { 'p-bg': '#062b32' } } } } }, root)
    const { css, at } = await themesLayer(app)
    expect(blockOf(css, '--p-bg: #062b32')).toMatch(/^\[data-theme='dark'\], \.dark \{/)
    expect(at('--p-bg: #062b32')).toBeGreaterThan(at('--p-bg: #0f172a'))
  })
})

describe('override по селектору и `strictTokens` у темы-файла', () => {
  it('override со своим селектором встаёт под него и после файла темы', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], tokenOverrides: { dark: { '.panel-dark': { 'p-bg': '#111827' } } } } }, root)
    const { css, at } = await themesLayer(app)
    expect(blockOf(css, '--p-bg: #111827')).toMatch(/^\.panel-dark \{/)
    expect(at('--p-bg: #111827')).toBeGreaterThan(at('--p-bg: #0f172a'))
  })

  it('блок, у которого `strictTokens` отбросил все токены, в CSS не попадает', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], strictTokens: true, tokenOverrides: { dark: { '.panel-dark': { 'p-unknown': '#000' } } } } }, root)
    expect(app.resolution.warnings).toEqual([{ kind: 'override-skipped', theme: 'dark', token: 'p-unknown' }])
    const { layers } = await emitCss(app)
    expect(layers.themes).not.toContain('.panel-dark')
    expect(layers.tokens).not.toContain('.panel-dark')
  })

  it('`strictTokens` знает токены всех блоков файла, селектор — первого', async () => {
    const { root, provider } = fileThemeProvider({ dark: `[data-theme='dark'], .dark {\n  --p-bg: #0f172a;\n}\n.dark-contrast {\n  --p-ring: #f8fafc;\n}\n` })
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], strictTokens: true, tokenOverrides: { dark: { 'p-ring': '#e2e8f0' } } } }, root)
    expect(app.resolution.warnings).toEqual([])
    const { css } = await themesLayer(app)
    expect(blockOf(css, '--p-ring: #e2e8f0')).toMatch(/^\[data-theme='dark'\], \.dark \{/)
  })
})

describe('факты о файле темы читает подготовка', () => {
  it('провайдер объектной формы: селектор файла берётся по его `baseUrl`', async () => {
    const { root, dist } = fileThemeProvider()
    const provider: GranumProvider = {
      id: '@p/obj',
      contractVersion: 1,
      components: [],
      theme: { themes: { light: 'theme/light.css', dark: 'theme/dark.css' }, defaultThemes: ['light', 'dark'] },
      baseUrl: `${pathToFileURL(dist).href}/`,
    }
    const app = await prepareTestApp({ providers: [provider], components: [], themes: { names: ['light', 'dark'], tokenOverrides: { dark: { 'p-primary': '#4fd1e0' } } } }, root)
    const { css, at } = await themesLayer(app)
    expect(blockOf(css, '--p-primary: #4fd1e0')).toMatch(/^\[data-theme='dark'\], \.dark \{/)
    expect(at('--p-primary: #4fd1e0')).toBeGreaterThan(at('--p-primary: #60a5fa'))
  })

  it('файла нет: подготовка не падает, ошибку чтения называет эмиссия', async () => {
    const { root, provider } = fileThemeProvider({ dark: null })
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], tokenOverrides: { dark: { 'p-primary': '#4fd1e0' } } } }, root)
    await expect(emitCss(app)).rejects.toBeInstanceOf(CssReadError)
  })

  it('файл без плоских блоков токенов фактов не даёт: override — под `:root`, как без файла', async () => {
    const { root, provider } = fileThemeProvider({ dark: '@media (prefers-color-scheme: dark) {\n  :root {\n    --p-bg: #0f172a;\n  }\n}\n' })
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'], tokenOverrides: { dark: { 'p-primary': '#4fd1e0' } } } }, root)
    expect((await emitCss(app)).layers.tokens).toContain('--p-primary: #4fd1e0')
  })
})

describe('манифест тем для темы-файла', () => {
  it('активация выводится из селектора файла и не зависит от селекции', async () => {
    const { root, provider } = fileThemeProvider()
    const themes = { names: ['light', 'dark'] }
    const expected = {
      light: { type: 'attribute', name: 'data-theme', value: 'light' },
      dark: { type: 'attribute', name: 'data-theme', value: 'dark' },
    }
    for (const components of [[], ['@p/ds:Plain'], ['@p/ds:Tinted'], ['@p/ds:Bare']]) {
      const app = await prepareTestApp({ providers: [provider], components, themes }, root)
      const manifest = getThemeManifest(app.resolution)
      expect(Object.fromEntries(manifest.themes.map(t => [t.name, t.activation])), JSON.stringify(components)).toEqual(expected)
      expect(manifest.themes.find(t => t.name === 'dark')!.selectors[0]).toBe(`[data-theme='dark'], .dark`)
    }
  })

  it('контроллер переключает тему-файл без ошибки', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: [], themes: { names: ['light', 'dark'] } }, root)
    const attributes = new Map<string, string>()
    const target = {
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    }
    const controller = createThemeController(getThemeManifest(app.resolution), { target, storage: null })
    controller.set('dark')
    expect(attributes.get('data-theme')).toBe('dark')
    controller.set('light')
    expect(attributes.get('data-theme')).toBe('light')
  })
})

describe('extends от темы-файла на подготовке приложения', () => {
  const ocean = { names: ['light', 'ocean'], define: { ocean: { extends: 'dark', selector: '[data-theme="ocean"]', tokens: { 'p-primary': '#4fd1e0' } } } }

  it('пример портала: ocean несёт значения dark.css и свои — при любой селекции', async () => {
    const { root, provider } = fileThemeProvider()
    for (const components of [['@p/ds:Plain'], ['@p/ds:Tinted']]) {
      const app = await prepareTestApp({ providers: [provider], components, themes: ocean }, root)
      const { css } = await themesLayer(app)
      expect(blockOf(css, '--p-bg: #0f172a'), JSON.stringify(components)).toBe('[data-theme="ocean"] {')
      expect(blockOf(css, '--p-primary: #4fd1e0'), JSON.stringify(components)).toMatch(/^\[data-theme="ocean"\] \{/)
      expect(app.resolution.warnings, JSON.stringify(components)).toEqual([])
    }
  })

  it.each([
    ['блок с другим селектором', `[data-theme='dark'], .dark {\n  --p-bg: #0f172a;\n}\n.dark-contrast {\n  --p-ring: #f8fafc;\n}\n`],
    ['блок под @media', `[data-theme='dark'], .dark {\n  --p-bg: #0f172a;\n}\n@media (prefers-contrast: more) {\n  [data-theme='dark'] {\n    --p-bg: #000000;\n  }\n}\n`],
  ])('%s в файле базы — theme-extends-partial, плоский блок всё равно наследуется', async (_, dark) => {
    const { root, provider } = fileThemeProvider({ dark })
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: ocean }, root)
    expect(app.resolution.warnings).toEqual([{ kind: 'theme-extends-partial', theme: 'ocean', base: 'dark', providers: ['@p/ds'] }])
    expect(blockOf((await themesLayer(app)).css, '--p-bg: #0f172a')).toBe('[data-theme="ocean"] {')
  })
})
