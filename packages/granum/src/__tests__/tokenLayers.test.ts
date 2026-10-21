import type { GranumComponentThemeTokens, GranumLoadedManifest, GranumThemeData } from '../contract'
import type { GranumThemeChoice, GranumThemeModes } from '../core/resolveThemes'
import { describe, expect, it } from 'vitest'
import { resolveGranum, resolveTokenValue } from '../core/resolve'
import { describeLayer } from '../core/tokenLayers'
import { allModes, INK, makeManifest, PAPER, themeData } from './helpers'

const OWNER = makeManifest('@p/ds', {}, {
  theme: {
    defaultTheme: 'paper',
    catalog: {
      paper: { title: 'Бумага', data: 'themes/paper.json', modes: ['light', 'dark'], defaultMode: 'light' },
      ink: { title: 'Чернила', extends: 'paper', data: 'themes/ink.json', modes: ['light', 'dark', 'dim'], defaultMode: 'light' },
    },
    declares: [],
  },
})

function ui(components: Record<string, Readonly<Record<string, GranumComponentThemeTokens>>>): GranumLoadedManifest {
  return makeManifest('@p/ui', Object.fromEntries(Object.entries(components).map(([name, themes]) => [name, { tokens: { themes, consumes: [], dynamic: [] } }])))
}

const BUTTON = ui({
  Button: {
    paper: { root: { 'b-gap': '8px' }, modes: { light: { 'b-bg': 'var(--p-accent)', 'b-shadow': 'soft' }, dark: { 'b-shadow': 'none' } } },
    ink: { modes: { light: { 'b-shadow': 'line' } } },
  },
})

function resolve(theme: GranumThemeChoice | undefined, modes?: GranumThemeModes, extra: GranumLoadedManifest[] = [BUTTON]) {
  const data = typeof theme === 'object' ? theme as GranumThemeData : theme === 'ink' ? INK : PAPER
  return resolveGranum({
    providers: [OWNER, ...extra],
    themes: [{ theme: theme ?? 'paper', modes: allModes(data, modes) }],
    themeData: { '@p/ds': { paper: PAPER, ink: INK } },
  })
}

describe('данные темы — первый слой; значение в каждом режиме', () => {
  it('root отдельно от режимов; режим наследует предков по extends', () => {
    const r = resolve('ink')
    expect(r.tokens.default!.root.get('p-radius')!.effective).toBe('2px')
    expect(resolveTokenValue(r, 'dim', 'p-bg')).toBe('#1e293b')
    expect(resolveTokenValue(r, 'dim', 'p-accent')).toBe('#60a5fa')
    expect(r.tokens.default!.modes.get('dim')!.get('p-accent')!.layers[0]).toMatchObject({ source: 'theme', theme: 'ink', mode: 'dark' })
  })

  it('токен из одного режима получает значение в каждом — из режима по умолчанию', () => {
    const data = themeData('solo', { light: { 'p-bg': '#fff', 'p-only': 'x' }, dark: { 'p-bg': '#000' } })
    const r = resolve(data)
    expect(resolveTokenValue(r, 'dark', 'p-only')).toBe('x')
    expect(r.tokens.default!.modes.get('dark')!.get('p-only')!.layers[0]!.mode).toBe('light')
  })
})

describe('фолбэки режима', () => {
  it('из режима по умолчанию — только по взятым у него токенам и раньше своих', () => {
    const data = themeData('solo', {
      light: { colorScheme: 'light', tokens: { 'p-bg': 'oklch(1 0 0)', 'p-fg': 'oklch(0 0 0)' }, fallbacks: [{ supports: 'x', tokens: { 'p-bg': '#fff', 'p-fg': '#000' } }] },
      dark: { colorScheme: 'dark', tokens: { 'p-fg': '#eee' }, fallbacks: [{ supports: 'x', tokens: { 'p-bg': '#111' } }] },
    })
    const blocks = resolve(data).tokens.default!.fallbacks.get('dark')!
    expect(blocks.map(block => [...block.tokens.keys()])).toEqual([['p-bg'], ['p-bg']])
    expect(blocks.map(block => block.tokens.get('p-bg')!.effective)).toEqual(['#fff', '#111'])
    expect(blocks[0]!.tokens.get('p-bg')!.layers[0]).toMatchObject({ theme: 'solo', mode: 'light' })
  })
})

describe('токены компонентов', () => {
  it('по токену: сначала режим и его предки, внутри — цепочка тем', () => {
    const r = resolve('ink')
    // ink-light: своё значение темы ink.
    expect(resolveTokenValue(r, 'light', 'b-shadow')).toBe('line')
    // ink-dark: у ink нет dark — берётся paper/dark, а не ink/light.
    expect(resolveTokenValue(r, 'dark', 'b-shadow')).toBe('none')
    // ink-dim: dim → dark → paper/dark.
    expect(resolveTokenValue(r, 'dim', 'b-shadow')).toBe('none')
    expect(r.tokens.default!.modes.get('dim')!.get('b-shadow')!.layers[0]).toMatchObject({ source: 'component', theme: 'paper', mode: 'dark', componentKey: '@p/ui:Button' })
    // Токен только в режиме по умолчанию — во всех режимах.
    expect(resolveTokenValue(r, 'dim', 'b-bg')).toBe('var(--p-accent)')
    // root — по цепочке тем.
    expect(r.tokens.default!.root.get('b-gap')!.layers[0]).toMatchObject({ theme: 'paper', mode: 'root' })
  })

  it('компонент без токенов для цепочки активной темы ничего не даёт', () => {
    const r = resolve('paper', undefined, [ui({ Chart: { ink: { modes: { light: { 'c-grid': '#ccc' } } } } })])
    expect(resolveTokenValue(r, 'light', 'c-grid')).toBeUndefined()
    expect(resolveTokenValue(resolve('ink', undefined, [ui({ Chart: { ink: { modes: { light: { 'c-grid': '#ccc' } } } } })]), 'light', 'c-grid')).toBe('#ccc')
  })

  it('тема-объект приложения перекрывает токены компонентов и наследует их через extends', () => {
    const brand = { ...themeData('brand', { light: { 'p-bg': '#fafafa', 'b-shadow': 'brand' }, dark: { 'p-bg': '#111' } }), extends: 'ink' }
    const r = resolve(brand)
    const chain = r.tokens.default!.modes.get('light')!.get('b-shadow')!
    expect(chain.layers.map(l => l.source)).toEqual(['component', 'app-theme'])
    expect(chain.effective).toBe('brand')
    expect(resolveTokenValue(r, 'dark', 'b-shadow')).toBe('none')
  })
})

describe('режимы приложения и override — последние слои', () => {
  it('define берёт итог базы и дописывает своё', () => {
    const r = resolve('paper', { define: { ocean: { extends: 'dark', tokens: { 'p-accent': '#0ea5e9' } } } })
    expect(resolveTokenValue(r, 'ocean', 'p-accent')).toBe('#0ea5e9')
    expect(resolveTokenValue(r, 'ocean', 'b-shadow')).toBe('none')
    expect(r.tokens.default!.modes.get('ocean')!.get('p-accent')!.layers.at(-1)).toMatchObject({ source: 'app-mode', mode: 'ocean' })
  })

  it('tokenOverrides: root — в корень, режим — в режим; последний слой', () => {
    const r = resolve('paper', { tokenOverrides: { root: { 'p-radius': '3px' }, dark: { 'p-bg': '#050505' } } })
    expect(r.tokens.default!.root.get('p-radius')!.effective).toBe('3px')
    expect(resolveTokenValue(r, 'dark', 'p-bg')).toBe('#050505')
    expect(resolveTokenValue(r, 'light', 'p-bg')).toBe('#ffffff')
    expect(describeLayer(r.tokens.default!.modes.get('dark')!.get('p-bg')!.layers.at(-1)!)).toBe('app override')
  })

  it('strictTokens: токен, который задаёт только режим define, известным не считается', () => {
    const r = resolve('paper', { strictTokens: true, define: { sepia: { extends: 'light', tokens: { 'app-x': '1' } } }, tokenOverrides: { root: { 'app-x': '2' } } })
    expect(r.tokens.default!.root.get('app-x')!.layers[0]!.skipped).toBe('strict-tokens')
    expect(r.warnings).toContainEqual({ kind: 'override-skipped', theme: 'paper', mode: 'root', token: 'app-x' })
  })

  it('strictTokens отбрасывает override неизвестного токена — с предупреждением и слоем skipped', () => {
    const r = resolve('paper', { strictTokens: true, tokenOverrides: { light: { 'p-bg': '#eee', 'nobody': '1' } } })
    expect(resolveTokenValue(r, 'light', 'nobody')).toBeUndefined()
    expect(r.tokens.default!.modes.get('light')!.get('nobody')!.layers[0]!.skipped).toBe('strict-tokens')
    expect(resolveTokenValue(r, 'light', 'p-bg')).toBe('#eee')
    expect(r.warnings).toContainEqual({ kind: 'override-skipped', theme: 'paper', mode: 'light', token: 'nobody' })
  })
})

describe('дополнительная тема', () => {
  it('полный набор своей темы; значение — по id темы; define и overrides — свои', () => {
    const r = resolve('ink', undefined, [BUTTON])
    const two = resolveGranum({
      providers: [OWNER, BUTTON],
      themes: [
        { theme: 'ink', default: true },
        { theme: 'paper', modes: { define: { ocean: { extends: 'dark', tokens: { 'p-bg': '#012' } } }, tokenOverrides: { root: { 'p-radius': '9px' } } } },
      ],
      themeData: { '@p/ds': { paper: PAPER, ink: INK } },
    })
    expect(two.tokens.themes.map(set => set.themeId)).toEqual(['ink', 'paper'])
    expect(two.tokens.default!.themeId).toBe('ink')
    expect(resolveTokenValue(two, 'light', 'b-shadow', 'paper')).toBe('soft')
    expect(resolveTokenValue(two, 'ocean', 'p-bg', 'paper')).toBe('#012')
    expect(resolveTokenValue(two, 'light', 'p-radius', 'paper')).toBe('9px')
    // Значения дополнительной темы не трогают основную.
    expect(resolveTokenValue(two, 'light', 'p-radius')).toBe('2px')
    expect(resolveTokenValue(r, 'light', 'b-shadow')).toBe('line')
  })
})

/** «Бумага» с данными, которые задают и токен кнопки: конфликт «данные против themesDir». */
const PAPER_WITH_SHADOW = themeData('paper', {
  light: { colorScheme: 'light', tokens: { ...PAPER.modes.light!.tokens, 'b-shadow': 'from-data' } },
  dark: PAPER.modes.dark!,
}, { title: 'Бумага', root: PAPER.root })

function resolveOver(paper: GranumThemeData, theme: GranumThemeChoice) {
  return resolveGranum({
    providers: [OWNER, BUTTON],
    themes: [{ theme, modes: allModes(paper) }],
    themeData: { '@p/ds': { paper, ink: INK } },
  })
}

describe('тема-объект с extends: унаследованное — слоем данных родителя (A-22, T-7, INV-THEME-14)', () => {
  const twin: GranumThemeChoice = { id: 'twin', title: 'Двойник', extends: 'paper' }

  it('наследник без отличий даёт по парам то же, что родитель, и при конфликте данных с токенами компонента', () => {
    const parent = resolveOver(PAPER_WITH_SHADOW, 'paper')
    const heir = resolveOver(PAPER_WITH_SHADOW, twin)
    for (const mode of ['light', 'dark']) {
      for (const token of ['p-bg', 'p-accent', 'b-bg', 'b-shadow', 'b-gap', 'p-radius'])
        expect(resolveTokenValue(heir, mode, token), `${mode}:${token}`).toBe(resolveTokenValue(parent, mode, token))
    }
    // Токены компонента идут после данных темы — и у родителя, и у наследника.
    expect(resolveTokenValue(heir, 'light', 'b-shadow')).toBe('soft')
    expect(heir.tokens.default!.modes.get('light')!.get('p-accent')!.layers).toEqual([{ source: 'theme', value: PAPER.modes.light!.tokens['p-accent'], theme: 'paper', mode: 'light' }])
  })

  it('собственные отличия — слоем приложения, после токенов компонента', () => {
    const own: GranumThemeChoice = { id: 'brand', title: 'Бренд', extends: 'paper', root: { 'p-radius': '9px' }, modes: { light: { tokens: { 'b-shadow': 'own' } } } }
    const r = resolveOver(PAPER_WITH_SHADOW, own)
    expect(resolveTokenValue(r, 'light', 'b-shadow')).toBe('own')
    expect(r.tokens.default!.modes.get('light')!.get('b-shadow')!.layers.map(layer => layer.source)).toEqual(['theme', 'component', 'app-theme'])
    expect(r.tokens.default!.root.get('p-radius')!.layers.map(layer => [layer.source, layer.value])).toEqual([['theme', '6px'], ['app-theme', '9px']])
    // Значение, совпавшее с родительским, вторым слоем не пишется.
    expect(r.tokens.default!.modes.get('dark')!.get('p-bg')!.layers.map(layer => layer.source)).toEqual(['theme'])
  })

  it('значение из режима по умолчанию — запасное: значение компонента в режиме им не перекрывается', () => {
    const own: GranumThemeChoice = { id: 'brand', title: 'Бренд', extends: 'paper', modes: { light: { tokens: { 'b-shadow': 'own' } } } }
    // Тёмный режим кнопки — свой у компонента (`none`), светлое значение объекта туда не приходит.
    expect(resolveTokenValue(resolveOver(PAPER, own), 'dark', 'b-shadow')).toBe('none')
  })
})

describe('фолбэк темы — к значению темы', () => {
  it('токен, чьё значение в паре дал компонент, фолбэков темы не получает; остальные — получают', () => {
    const paper = themeData('paper', {
      light: { colorScheme: 'light', tokens: { ...PAPER.modes.light!.tokens, 'b-bg': 'oklch(0.6 0.2 250)', 'p-bg': 'oklch(1 0 0)' }, fallbacks: [{ supports: 'x', tokens: { 'b-bg': '#2563eb', 'p-bg': '#fff' } }] },
      dark: PAPER.modes.dark!,
    }, { title: 'Бумага', root: PAPER.root })
    const fallbacks = resolveOver(paper, 'paper').tokens.default!.fallbacks
    expect([...fallbacks.get('light')![0]!.tokens.keys()]).toEqual(['p-bg'])
    // В тёмном `p-bg` свой, а `b-bg` даёт компонент: фолбэков режима по умолчанию нет вовсе.
    expect(fallbacks.get('dark')).toBeUndefined()
  })
})
