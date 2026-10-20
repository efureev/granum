/**
 * Блоки CSS темы и режимов (T-8…T-13, A-32): что уходит в слой `tokens`, что в
 * `themes`, под какими селекторами и в каком порядке.
 */
import type { GranumEngine } from '../engine/types'
import type { PreparedApp } from '../node/prepare'
import { describe, expect, it } from 'vitest'
import { resolveTokenValue } from '../core/resolve'
import { emitCss } from '../node/emit'
import { cascade } from './cascade'
import { catalogProvider, INK, PAPER, prepareTestApp, TEST_ENGINE, themeData } from './helpers'

function blockOf(css: string, selector: string): string | undefined {
  const at = css.indexOf(`${selector} {`)
  if (at < 0)
    return undefined
  return css.slice(at, css.indexOf('}', at) + 1)
}

async function layers(app: PreparedApp): Promise<{ tokens: string, themes: string, base: string }> {
  const { layers } = await emitCss(app)
  return layers
}

describe('корень и режимы (T-8, T-9, T-12)', () => {
  it('литералы root — в tokens под :root; формулы root — под :root, [attr]', async () => {
    const { root, provider } = catalogProvider()
    const app = await prepareTestApp({ providers: [provider] }, root)
    const { tokens, themes } = await layers(app)
    expect(blockOf(tokens, ':root')).toContain('--p-radius: 6px;')
    expect(tokens).not.toContain('--p-ring')
    expect(blockOf(themes, ':root, [data-theme]')).toContain('--p-ring: 0 0 0 2px var(--p-accent);')
  })

  it('режим по умолчанию первым под :root и парой, остальные под парой; color-scheme в блоке', async () => {
    const { root, provider } = catalogProvider()
    const { themes } = await layers(await prepareTestApp({ providers: [provider], theme: 'ink', modes: { names: ['light', 'dark', 'dim'] } }, root))
    const light = themes.indexOf(':root, [data-theme="ink-light"] {')
    const dark = themes.indexOf('[data-theme="ink-dark"] {')
    const dim = themes.indexOf('[data-theme="ink-dim"] {')
    expect(light).toBeGreaterThan(themes.indexOf(':root, [data-theme] {'))
    expect(light).toBeLessThan(dark)
    expect(dark).toBeLessThan(dim)
    expect(blockOf(themes, '[data-theme="ink-dim"]')).toContain('color-scheme: dark;')
    expect(blockOf(themes, ':root, [data-theme="ink-light"]')).toContain('color-scheme: light;')
  })

  it('классов .light/.dark нет (T-11); данных других тем нет (T-6)', async () => {
    const { root, provider } = catalogProvider()
    const { css } = await emitCss(await prepareTestApp({ providers: [provider], theme: 'ink' }, root))
    expect(css).not.toMatch(/\.(?:light|dark)\b/)
    expect(css).not.toContain('paper-')
    expect(css).not.toContain('#2563eb')
  })
})

describe('формулы режимов (T-10)', () => {
  it('формула, одинаковая во всех режимах, — один раз под общей границей; разная — в блоках режимов', async () => {
    const theme = themeData('t', {
      light: { 'p-bg': '#fff', 'p-soft': 'color-mix(in oklab, var(--p-bg) 90%, black)', 'p-edge': 'var(--p-bg)' },
      dark: { 'p-bg': '#000', 'p-soft': 'color-mix(in oklab, var(--p-bg) 90%, black)', 'p-edge': 'var(--p-soft)' },
    })
    const { root, provider } = catalogProvider({ themes: { t: theme } })
    const { themes } = await layers(await prepareTestApp({ providers: [provider], modes: { names: ['light', 'dark'] } }, root))
    expect(blockOf(themes, ':root, [data-theme]')).toContain('--p-soft:')
    expect(blockOf(themes, ':root, [data-theme="t-light"]')).not.toContain('--p-soft')
    expect(blockOf(themes, ':root, [data-theme="t-light"]')).toContain('--p-edge: var(--p-bg);')
    expect(blockOf(themes, '[data-theme="t-dark"]')).toContain('--p-edge: var(--p-soft);')
  })
})

describe('фолбэки, системная схема', () => {
  const theme = themeData('t', {
    light: { colorScheme: 'light', tokens: { 'p-bg': '#fff' }, fallbacks: [{ supports: 'not (color: oklch(0 0 0))', tokens: { 'p-bg': 'white' } }] },
    dark: { 'p-bg': '#000' },
  })

  it('@supports после всех режимов, под селектором режима; у режима по умолчанию — корень без атрибута и пара', async () => {
    const { root, provider } = catalogProvider({ themes: { t: theme } })
    const { themes } = await layers(await prepareTestApp({ providers: [provider], modes: { names: ['light', 'dark'] } }, root))
    const supports = themes.indexOf('@supports not (color: oklch(0 0 0)) {')
    expect(supports).toBeGreaterThan(themes.indexOf('[data-theme="t-dark"] {'))
    expect(themes.slice(supports)).toContain(':root:not([data-theme]), [data-theme="t-light"] {\n    --p-bg: white;')
  })

  it('режим приложения: фолбэки базы, затем свои — свои перекрывают по токену', async () => {
    const { root, provider } = catalogProvider({ themes: { t: theme } })
    const ocean = { extends: 'light', tokens: { 'p-bg': '#012' }, fallbacks: [{ supports: 'not (color: oklch(0 0 0))', tokens: { 'p-bg': 'navy' } }] }
    const { themes } = await layers(await prepareTestApp({ providers: [provider], modes: { define: { ocean, plain: { extends: 'light' } } } }, root))
    const inherited = themes.indexOf('[data-theme="t-ocean"] {\n    --p-bg: white;')
    const own = themes.indexOf('[data-theme="t-ocean"] {\n    --p-bg: navy;')
    expect(inherited).toBeGreaterThan(-1)
    expect(own).toBeGreaterThan(inherited)
    // Без своих фолбэков режим берёт фолбэки базы как есть.
    expect(themes).toContain('[data-theme="t-plain"] {\n    --p-bg: white;')
  })

  it('system: media — тёмный режим по prefers-color-scheme, пока атрибут не выставлен (T-13)', async () => {
    const { root, provider } = catalogProvider({ themes: { t: theme } })
    const { themes } = await layers(await prepareTestApp({ providers: [provider], modes: { names: ['light', 'dark'], system: 'media' } }, root))
    expect(themes).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n    color-scheme: dark;\n    --p-bg: #000;')
  })
})

describe('каскад в браузере, которому нужен фолбэк', () => {
  const OLD = 'not (color: oklch(0 0 0))'
  const light = { colorScheme: 'light' as const, tokens: { 'p-bg': 'oklch(98% 0 0)', 'p-fg': '#111111' }, fallbacks: [{ supports: OLD, tokens: { 'p-bg': '#fafafa' } }] }

  async function pageCss(theme: ReturnType<typeof themeData>, system?: 'media'): Promise<string[]> {
    const { root, provider } = catalogProvider({ themes: { t: theme } })
    const { tokens, themes } = await layers(await prepareTestApp({ providers: [provider], modes: { names: ['light', 'dark'], ...(system ? { system } : {}) } }, root))
    return [tokens, themes]
  }

  it('фолбэк режима по умолчанию не перебивает другой режим на корне', async () => {
    const css = await pageCss(themeData('t', { light, dark: { 'p-bg': '#000000', 'p-fg': '#eeeeee' } }))
    expect(cascade(css, { root: 't-dark', supports: [OLD] }).get('--p-bg')).toBe('#000000')
    // Сам фолбэк действует: на корне без атрибута и на паре режима по умолчанию.
    expect(cascade(css, { supports: [OLD] }).get('--p-bg')).toBe('#fafafa')
    expect(cascade(css, { root: 't-light', supports: [OLD] }).get('--p-bg')).toBe('#fafafa')
    expect(cascade(css, { root: 't-light', island: 't-dark', supports: [OLD] }).get('--p-bg')).toBe('#000000')
  })

  it('system: media — корень без атрибута при тёмной схеме берёт фолбэки тёмного режима', async () => {
    const dark = { colorScheme: 'dark' as const, tokens: { 'p-bg': 'oklch(20% 0 0)', 'p-fg': '#eeeeee' }, fallbacks: [{ supports: OLD, tokens: { 'p-bg': '#111111' } }] }
    const css = await pageCss(themeData('t', { light, dark }), 'media')
    expect(cascade(css, { scheme: 'dark' }).get('--p-bg')).toBe('oklch(20% 0 0)')
    expect(cascade(css, { scheme: 'dark', supports: [OLD] }).get('--p-bg')).toBe('#111111')
    expect(cascade(css, { root: 't-dark', supports: [OLD] }).get('--p-bg')).toBe('#111111')
  })
})

describe('режим приложения поверх режима темы — `ocean` (A-26)', () => {
  it('ocean extends dark: значения dark и токены компонента для dark по цепочке, своё — поверх', async () => {
    const { root, provider } = catalogProvider({
      components: { Card: { themes: { paper: { modes: { dark: { 'c-shade': '#020617' } } } } } },
    })
    const app = await prepareTestApp({ providers: [provider], modes: { define: { ocean: { extends: 'dark', colorScheme: 'dark', tokens: { 'p-fg': '#4fd1e0' } } } } }, root)
    const block = blockOf((await layers(app)).themes, '[data-theme="paper-ocean"]')!
    expect(block).toContain('--p-bg: #000000;')
    expect(block).toContain('--c-shade: #020617;')
    expect(block).toContain('--p-fg: #4fd1e0;')
    expect(resolveTokenValue(app.resolution, 'ocean', 'p-fg')).toBe('#4fd1e0')
  })

  it('override режима лежит в его блоке после данных и токенов компонента', async () => {
    const { root, provider } = catalogProvider()
    const app = await prepareTestApp({ providers: [provider], modes: { tokenOverrides: { light: { 'p-bg': '#fafafa' }, root: { 'p-radius': '1px' } } } }, root)
    const { tokens, themes } = await layers(app)
    expect(blockOf(themes, ':root, [data-theme="paper-light"]')).toContain('--p-bg: #fafafa;')
    expect(blockOf(tokens, ':root')).toContain('--p-radius: 1px;')
  })
})

describe('превью (A-32)', () => {
  it('полные блоки пар превью, никогда под :root; формулы под префиксом её пар', async () => {
    const { root, provider } = catalogProvider()
    const { themes } = await layers(await prepareTestApp({ providers: [provider], theme: 'ink', previews: ['paper'] }, root))
    const paperLight = blockOf(themes, '[data-theme="paper-light"]')!
    expect(paperLight).toContain('--p-radius: 6px;')
    expect(paperLight).toContain('--p-accent: #2563eb;')
    expect(paperLight).toContain('color-scheme: light;')
    expect(themes).not.toContain(':root, [data-theme="paper-')
    expect(blockOf(themes, '[data-theme^="paper-"]')).toContain('--p-ring:')
    expect(themes.indexOf('[data-theme^="paper-"]')).toBeGreaterThan(themes.indexOf('[data-theme="ink-dim"]'))
  })

  it('baseCss активной темы и превью — в слой base, без повторов', async () => {
    const font = '@font-face { font-family: Paper; src: url(paper.woff2); }'
    const { root, provider } = catalogProvider({
      themes: { paper: { ...PAPER, baseCss: [font] }, ink: { ...INK, baseCss: [font], extends: 'paper' } },
    })
    const { base } = await layers(await prepareTestApp({ providers: [provider], theme: 'ink', previews: ['paper'] }, root))
    expect(base.split(font)).toHaveLength(2)
  })
})

describe('без тем', () => {
  it('провайдер без каталога: слой themes пуст', async () => {
    const { root, provider } = catalogProvider({ themes: {}, defaultTheme: 'x' })
    const bare = { ...provider, manifest: { ...provider.manifest, theme: { declares: [] } } }
    const { themes } = await layers(await prepareTestApp({ providers: [bare] }, root))
    expect(themes).toBe('')
  })
})

describe('селектор тёмных режимов для движка (E-20)', () => {
  it('пары режимов с colorScheme dark входом generate; без тёмных режимов поля нет', async () => {
    const seen: (string | undefined)[] = []
    const engine: GranumEngine = { ...TEST_ENGINE, generate: (input) => {
      seen.push(input.darkSelector)
      return TEST_ENGINE.generate(input)
    } }
    const { root, provider } = catalogProvider()
    await emitCss(await prepareTestApp({ providers: [provider], theme: 'ink', engine, modes: { names: ['light', 'dark', 'dim'] } }, root))
    expect(seen.at(-1)).toBe('[data-theme="ink-dark"], [data-theme="ink-dim"]')
    await emitCss(await prepareTestApp({ providers: [provider], theme: 'ink', engine, modes: { names: ['light'] } }, root))
    expect(seen.at(-1)).toBeUndefined()
  })
})
