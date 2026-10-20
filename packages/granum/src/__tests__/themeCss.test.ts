/**
 * Блоки CSS темы и режимов: что уходит в слой `tokens`, что в
 * `themes`, под какими селекторами и в каком порядке.
 */
import type { GranumEngine } from '../engine/types'
import type { PreparedApp } from '../node/prepare'
import { describe, expect, it } from 'vitest'
import { resolveTokenValue } from '../core/resolve'
import { emitCss } from '../node/emit'
import { emitThemeCss } from '../node/themeCss'
import { cascade } from './cascade'
import { catalogProvider, INK, PAPER, prepareTestApp, TEST_ENGINE, themeData } from './helpers'

/**
 * Начало блока с этим селектором — с начала строки: пара в конце списка общей
 * границы (`…, [data-theme="t-dark"] {`) иначе выдавала бы себя за блок режима.
 */
function blockAt(css: string, selector: string): number {
  const line = css.split('\n').findIndex(text => text.trimStart() === `${selector} {`)
  return line < 0 ? -1 : css.split('\n').slice(0, line).join('\n').length + (line > 0 ? 1 : 0)
}

function blockOf(css: string, selector: string): string | undefined {
  const at = blockAt(css, selector)
  if (at < 0)
    return undefined
  return css.slice(at, css.indexOf('}', at) + 1)
}

async function layers(app: PreparedApp): Promise<{ tokens: string, themes: string, base: string }> {
  const { layers } = await emitCss(app)
  return layers
}

describe('корень и режимы', () => {
  it('литералы root — в tokens под корнем без атрибута и парами темы; формулы root — под :where(:root) и парами', async () => {
    const { root, provider } = catalogProvider()
    const app = await prepareTestApp({ providers: [provider] }, root)
    const { tokens, themes } = await layers(app)
    expect(blockOf(tokens, ':root:not([data-theme]), [data-theme="paper-light"]')).toContain('--p-radius: 6px;')
    expect(tokens).not.toContain('--p-ring')
    expect(blockOf(themes, ':where(:root), [data-theme="paper-light"]')).toContain('--p-ring: 0 0 0 2px var(--p-accent);')
    // Граница — пары темы, а не любое значение атрибута: пару другой темы она не достаёт.
    expect(themes).not.toContain(':root, [data-theme] {')
  })

  it('режим по умолчанию первым под :root и парой, остальные под парой; color-scheme в блоке', async () => {
    const { root, provider } = catalogProvider()
    const { themes } = await layers(await prepareTestApp({ providers: [provider], themes: [{ theme: 'ink', modes: ['light', 'dark', 'dim'] }] }, root))
    const light = blockAt(themes, ':where(:root), [data-theme="ink-light"]')
    const dark = blockAt(themes, '[data-theme="ink-dark"]')
    const dim = blockAt(themes, '[data-theme="ink-dim"]')
    expect(light).toBeGreaterThan(blockAt(themes, ':where(:root), [data-theme="ink-light"], [data-theme="ink-dark"], [data-theme="ink-dim"]'))
    expect(light).toBeLessThan(dark)
    expect(dark).toBeLessThan(dim)
    expect(blockOf(themes, '[data-theme="ink-dim"]')).toContain('color-scheme: dark;')
    expect(blockOf(themes, ':where(:root), [data-theme="ink-light"]')).toContain('color-scheme: light;')
  })

  it('классов .light/.dark нет; данных других тем нет', async () => {
    const { root, provider } = catalogProvider()
    const { css } = await emitCss(await prepareTestApp({ providers: [provider], themes: ['ink'] }, root))
    expect(css).not.toMatch(/\.(?:light|dark)\b/)
    expect(css).not.toContain('paper-')
    expect(css).not.toContain('#2563eb')
  })
})

describe('формулы режимов', () => {
  it('формула, одинаковая во всех режимах, — один раз под общей границей; разная — в блоках режимов', async () => {
    const theme = themeData('t', {
      light: { 'p-bg': '#fff', 'p-soft': 'color-mix(in oklab, var(--p-bg) 90%, black)', 'p-edge': 'var(--p-bg)' },
      dark: { 'p-bg': '#000', 'p-soft': 'color-mix(in oklab, var(--p-bg) 90%, black)', 'p-edge': 'var(--p-soft)' },
    })
    const { root, provider } = catalogProvider({ themes: { t: theme } })
    const { themes } = await layers(await prepareTestApp({ providers: [provider], themes: [{ theme: 't', modes: ['light', 'dark'] }] }, root))
    expect(blockOf(themes, ':where(:root), [data-theme="t-light"], [data-theme="t-dark"]')).toContain('--p-soft:')
    expect(blockOf(themes, ':where(:root), [data-theme="t-light"]')).not.toContain('--p-soft')
    expect(blockOf(themes, ':where(:root), [data-theme="t-light"]')).toContain('--p-edge: var(--p-bg);')
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
    const { themes } = await layers(await prepareTestApp({ providers: [provider], themes: [{ theme: 't', modes: ['light', 'dark'] }] }, root))
    const supports = themes.indexOf('@supports not (color: oklch(0 0 0)) {')
    expect(supports).toBeGreaterThan(themes.indexOf('[data-theme="t-dark"] {'))
    expect(themes.slice(supports)).toContain(':root:not([data-theme]), [data-theme="t-light"] {\n    --p-bg: white;')
  })

  it('режим приложения: фолбэки базы, затем свои — свои перекрывают по токену', async () => {
    const { root, provider } = catalogProvider({ themes: { t: theme } })
    const ocean = { extends: 'light', tokens: { 'p-bg': '#012' }, fallbacks: [{ supports: 'not (color: oklch(0 0 0))', tokens: { 'p-bg': 'navy' } }] }
    const { themes } = await layers(await prepareTestApp({ providers: [provider], themes: [{ theme: 't', modes: { define: { ocean, plain: { extends: 'light' } } } }] }, root))
    const inherited = themes.indexOf('[data-theme="t-ocean"] {\n    --p-bg: white;')
    const own = themes.indexOf('[data-theme="t-ocean"] {\n    --p-bg: navy;')
    expect(inherited).toBeGreaterThan(-1)
    expect(own).toBeGreaterThan(inherited)
    // Без своих фолбэков режим берёт фолбэки базы как есть.
    expect(themes).toContain('[data-theme="t-plain"] {\n    --p-bg: white;')
  })

  it('system: media — тёмный режим по prefers-color-scheme, пока атрибут не выставлен', async () => {
    const { root, provider } = catalogProvider({ themes: { t: theme } })
    const { themes } = await layers(await prepareTestApp({ providers: [provider], themes: [{ theme: 't', modes: ['light', 'dark'] }], activation: { system: 'media' } }, root))
    expect(themes).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n    color-scheme: dark;\n    --p-bg: #000;')
  })
})

describe('каскад в браузере, которому нужен фолбэк', () => {
  const OLD = 'not (color: oklch(0 0 0))'
  const light = { colorScheme: 'light' as const, tokens: { 'p-bg': 'oklch(98% 0 0)', 'p-fg': '#111111' }, fallbacks: [{ supports: OLD, tokens: { 'p-bg': '#fafafa' } }] }

  async function pageCss(theme: ReturnType<typeof themeData>, system?: 'media'): Promise<string[]> {
    const { root, provider } = catalogProvider({ themes: { t: theme } })
    const { tokens, themes } = await layers(await prepareTestApp({ providers: [provider], themes: [{ theme: 't', modes: ['light', 'dark'] }], ...(system ? { activation: { system } } : {}) }, root))
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

  it('токен, взятый из режима по умолчанию, приходит с его фолбэком — на корне, на острове и по системной схеме', async () => {
    const css = await pageCss(themeData('t', { light, dark: { 'p-fg': '#eeeeee' } }), 'media')
    expect(cascade(css, { root: 't-dark' }).get('--p-bg')).toBe('oklch(98% 0 0)')
    expect(cascade(css, { root: 't-dark', supports: [OLD] }).get('--p-bg')).toBe('#fafafa')
    expect(cascade(css, { root: 't-light', island: 't-dark', supports: [OLD] }).get('--p-bg')).toBe('#fafafa')
    expect(cascade(css, { scheme: 'dark', supports: [OLD] }).get('--p-bg')).toBe('#fafafa')
  })

  it('system: media — корень без атрибута при тёмной схеме берёт фолбэки тёмного режима', async () => {
    const dark = { colorScheme: 'dark' as const, tokens: { 'p-bg': 'oklch(20% 0 0)', 'p-fg': '#eeeeee' }, fallbacks: [{ supports: OLD, tokens: { 'p-bg': '#111111' } }] }
    const css = await pageCss(themeData('t', { light, dark }), 'media')
    expect(cascade(css, { scheme: 'dark' }).get('--p-bg')).toBe('oklch(20% 0 0)')
    expect(cascade(css, { scheme: 'dark', supports: [OLD] }).get('--p-bg')).toBe('#111111')
    expect(cascade(css, { root: 't-dark', supports: [OLD] }).get('--p-bg')).toBe('#111111')
  })
})

describe('формулы дополнительной темы на корне основной', () => {
  const theme = (id: string, ring: string): ReturnType<typeof themeData> => themeData(id, {
    light: { 'p-accent': '#2563eb' },
    dark: { 'p-accent': '#60a5fa' },
  }, { root: { 'p-ring': ring } })
  const WIDE = '0 0 0 3px var(--p-accent)'
  const THIN = '0 0 0 1px var(--p-accent)'

  async function sheets(config: Parameters<typeof prepareTestApp>[0], root: string): Promise<{ tokens: string, themes: string, extra: string }> {
    const css = await emitCss(await prepareTestApp(config, root))
    return { tokens: css.layers.tokens, themes: css.layers.themes, extra: Object.values(css.themeSheets).map(bare).join('\n') }
  }

  /** Блоки листа дополнительной темы без обёрток и метки: каскад считает один слой `themes`. */
  function bare(sheet: string): string {
    return sheet.replace(/\n@property [^{]+\{[^}]*\}\n?$/, '').replace(/^@layer [^;{]+;\n/, '').replace(/^@layer granum\.themes \{\n/, '').replace(/\n\}\n?$/, '')
  }

  it('id основной темы начинается с id дополнительной и дефиса: формулы дополнительной до корня не доходят', async () => {
    const { root, provider } = catalogProvider({ themes: { 'slate-hc': theme('slate-hc', WIDE), 'slate': theme('slate', THIN) } })
    const { tokens, themes, extra } = await sheets({ providers: [provider], themes: [{ theme: 'slate-hc', default: true }, { theme: 'slate', modes: ['light', 'dark'] }] }, root)
    const layer = `${themes}\n${extra}`
    expect(cascade([tokens, layer], { root: 'slate-hc-light' }).get('--p-ring')).toBe(WIDE)
    expect(cascade([tokens, layer], { root: 'slate-hc-light', island: 'slate-dark' }).get('--p-ring')).toBe(THIN)
  })

  it('шаблон со статикой перед режимом: формулы дополнительной темы до корня не доходят', async () => {
    const { root, provider } = catalogProvider({ themes: { paper: theme('paper', WIDE), ink: theme('ink', THIN) } })
    const activation = { attribute: 'data-theme', value: 'x-{mode}-{theme}' }
    const { tokens, themes, extra } = await sheets({ providers: [provider], themes: [{ theme: 'paper', default: true }, { theme: 'ink', modes: ['light', 'dark'] }], activation }, root)
    const layer = `${themes}\n${extra}`
    expect(cascade([tokens, layer], { root: 'x-light-paper' }).get('--p-ring')).toBe(WIDE)
    expect(cascade([tokens, layer], { root: 'x-light-paper', island: 'x-dark-ink' }).get('--p-ring')).toBe(THIN)
  })

  it('пара дополнительной темы на корне перекрывает основную при любом порядке листов', async () => {
    const { root, provider } = catalogProvider({ themes: { paper: theme('paper', WIDE), ink: theme('ink', THIN) } })
    const { tokens, themes, extra } = await sheets({ providers: [provider], themes: [{ theme: 'paper', default: true, modes: ['light', 'dark'] }, { theme: 'ink', modes: ['light', 'dark'] }] }, root)
    for (const layer of [`${themes}\n${extra}`, `${extra}\n${themes}`]) {
      const onRoot = cascade([tokens, layer], { root: 'ink-dark' })
      expect(onRoot.get('--p-ring')).toBe(THIN)
      expect(onRoot.get('--p-accent')).toBe('#60a5fa')
      // Основная тема на корне — тоже от порядка не зависит.
      expect(cascade([tokens, layer], { root: 'paper-dark' }).get('--p-ring')).toBe(WIDE)
      expect(cascade([tokens, layer]).get('--p-ring')).toBe(WIDE)
    }
  })

  it('литералы root основной темы: корень с чужой парой их не получает, остров основной — получает', async () => {
    const literal = (id: string, ring: string, radius: string): ReturnType<typeof themeData> => themeData(id, {
      light: { 'p-accent': '#2563eb' },
      dark: { 'p-accent': '#60a5fa' },
    }, { root: { 'p-ring': ring, 'p-radius': radius } })
    const { root, provider } = catalogProvider({ themes: { paper: literal('paper', WIDE, '6px'), ink: literal('ink', THIN, '2px') } })
    const { tokens, themes, extra } = await sheets({ providers: [provider], themes: [{ theme: 'paper', default: true, modes: ['light', 'dark'] }, { theme: 'ink', modes: ['light', 'dark'] }] }, root)
    // Слоями: остров основной темы внутри корня дополнительной — со своими литералами, а не с унаследованными.
    expect(cascade([tokens, `${themes}\n${extra}`], { root: 'ink-light', island: 'paper-dark' }).get('--p-radius')).toBe('6px')
    // Без слоёв (`css.layers: false`) — один каскад, листы в любом порядке.
    for (const sheet of [`${tokens}\n${themes}\n${extra}`, `${extra}\n${tokens}\n${themes}`]) {
      expect(cascade([sheet], { root: 'ink-light' }).get('--p-radius')).toBe('2px')
      expect(cascade([sheet], { root: 'paper-light' }).get('--p-radius')).toBe('6px')
      expect(cascade([sheet]).get('--p-radius')).toBe('6px')
      expect(cascade([sheet], { root: 'ink-light', island: 'paper-dark' }).get('--p-radius')).toBe('6px')
    }
  })
})

describe('режим приложения поверх режима темы — `ocean`', () => {
  it('ocean extends dark: значения dark и токены компонента для dark по цепочке, своё — поверх', async () => {
    const { root, provider } = catalogProvider({
      components: { Card: { themes: { paper: { modes: { dark: { 'c-shade': '#020617' } } } } } },
    })
    const app = await prepareTestApp({ providers: [provider], themes: [{ theme: 'paper', modes: { define: { ocean: { extends: 'dark', colorScheme: 'dark', tokens: { 'p-fg': '#4fd1e0' } } } } }] }, root)
    const block = blockOf((await layers(app)).themes, '[data-theme="paper-ocean"]')!
    expect(block).toContain('--p-bg: #000000;')
    expect(block).toContain('--c-shade: #020617;')
    expect(block).toContain('--p-fg: #4fd1e0;')
    expect(resolveTokenValue(app.resolution, 'ocean', 'p-fg')).toBe('#4fd1e0')
  })

  it('override режима лежит в его блоке после данных и токенов компонента', async () => {
    const { root, provider } = catalogProvider()
    const app = await prepareTestApp({ providers: [provider], themes: [{ theme: 'paper', modes: { names: ['light', 'dark'], tokenOverrides: { light: { 'p-bg': '#fafafa' }, root: { 'p-radius': '1px' } } } }] }, root)
    const { tokens, themes } = await layers(app)
    expect(blockOf(themes, ':where(:root), [data-theme="paper-light"]')).toContain('--p-bg: #fafafa;')
    expect(blockOf(tokens, ':root:not([data-theme]), [data-theme="paper-light"], [data-theme="paper-dark"]')).toContain('--p-radius: 1px;')
  })
})

describe('дополнительная тема', () => {
  it('полные блоки пар, никогда под :root; формулы под списком её пар; в общем листе её нет', async () => {
    const { root, provider } = catalogProvider()
    const app = await prepareTestApp({ providers: [provider], themes: [{ theme: 'ink', default: true }, { theme: 'paper', modes: ['light', 'dark'] }] }, root)
    const css = await emitCss(app)
    expect(css.layers.themes).not.toContain('paper-')
    const sheet = css.themeSheets.paper!
    const paperLight = blockOf(sheet, '[data-theme="paper-light"]')!
    expect(paperLight).toContain('--p-radius: 6px;')
    expect(paperLight).toContain('--p-accent: #2563eb;')
    expect(paperLight).toContain('color-scheme: light;')
    expect(sheet).not.toContain(':root')
    expect(blockOf(sheet, '[data-theme="paper-light"], [data-theme="paper-dark"]')).toContain('--p-ring:')
    // Лист самодостаточен: объявление порядка слоёв первым, блоки — в слое themes.
    expect(sheet.startsWith('@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;')).toBe(true)
    expect(sheet).toContain('@layer granum.themes {')
    // Метка — последним правилом и вне слоёв: по ней загрузчик узнаёт статически подключённый лист.
    const marker = sheet.indexOf('@property --granum-sheet-paper {')
    expect(sheet.trimEnd().endsWith('@property --granum-sheet-paper { syntax: \'<integer>\'; inherits: false; initial-value: 1; }')).toBe(true)
    const before = sheet.slice(0, marker)
    expect(before.split('{').length).toBe(before.split('}').length)
  })

  it('режимы дополнительной темы — по правилу набора: без modes — только режим по умолчанию', async () => {
    const { root, provider } = catalogProvider()
    const app = await prepareTestApp({ providers: [provider], themes: [{ theme: 'ink', default: true }, 'paper'] }, root)
    const { additional } = emitThemeCss(app.resolution)
    expect(additional.map(sheet => sheet.id)).toEqual(['paper'])
    expect(additional[0]!.themes.join('\n')).toContain('[data-theme="paper-light"]')
    expect(additional[0]!.themes.join('\n')).not.toContain('paper-dark')
  })

  it('baseCss: основной — в слой base общего листа, дополнительной — в её лист, без повторов', async () => {
    const font = '@font-face { font-family: Paper; src: url(paper.woff2); }'
    const own = '@font-face { font-family: Ink; src: url(ink.woff2); }'
    const { root, provider } = catalogProvider({
      themes: { paper: { ...PAPER, baseCss: [font] }, ink: { ...INK, baseCss: [font, own], extends: 'paper' } },
    })
    const css = await emitCss(await prepareTestApp({ providers: [provider], themes: [{ theme: 'paper', default: true }, 'ink'] }, root))
    expect(css.layers.base.split(font)).toHaveLength(2)
    expect(css.layers.base).not.toContain(own)
    expect(css.themeSheets.ink).toContain(own)
    expect(css.themeSheets.ink).not.toContain(font)
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

describe('селектор тёмных режимов для движка', () => {
  it('пары режимов с colorScheme dark входом generate; без тёмных режимов поля нет', async () => {
    const seen: (string | undefined)[] = []
    const engine: GranumEngine = { ...TEST_ENGINE, generate: (input) => {
      seen.push(input.darkSelector)
      return TEST_ENGINE.generate(input)
    } }
    const { root, provider } = catalogProvider()
    await emitCss(await prepareTestApp({ providers: [provider], engine, themes: [{ theme: 'ink', modes: ['light', 'dark', 'dim'] }] }, root))
    expect(seen.at(-1)).toBe('[data-theme="ink-dark"], [data-theme="ink-dim"]')
    await emitCss(await prepareTestApp({ providers: [provider], engine, themes: [{ theme: 'ink', modes: ['light'] }] }, root))
    expect(seen.at(-1)).toBeUndefined()
    // Тёмные пары дополнительной темы — тоже: утилиты `dark:` живут в общем листе.
    await emitCss(await prepareTestApp({ providers: [provider], engine, themes: [{ theme: 'ink', default: true, modes: ['light'] }, { theme: 'paper', modes: ['light', 'dark'] }] }, root))
    expect(seen.at(-1)).toBe('[data-theme="paper-dark"]')
  })
})
