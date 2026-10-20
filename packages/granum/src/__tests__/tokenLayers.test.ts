import type { GranumComponentThemeTokens, GranumLoadedManifest } from '../contract'
import type { GranumModesInput, GranumThemeChoice } from '../core/resolveThemes'
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

function resolve(theme: GranumThemeChoice | undefined, modes?: GranumModesInput, extra: GranumLoadedManifest[] = [BUTTON]) {
  const data = typeof theme === 'object' ? theme : theme === 'ink' ? INK : PAPER
  return resolveGranum({
    providers: [OWNER, ...extra],
    ...(theme !== undefined ? { theme } : {}),
    modes: allModes(data, modes),
    themeData: { '@p/ds': { paper: PAPER, ink: INK } },
  })
}

describe('данные темы (T-7 слой 1, T-10)', () => {
  it('root отдельно от режимов; режим наследует предков по extends', () => {
    const r = resolve('ink')
    expect(r.tokens.active!.root.get('p-radius')!.effective).toBe('2px')
    expect(resolveTokenValue(r, 'dim', 'p-bg')).toBe('#1e293b')
    expect(resolveTokenValue(r, 'dim', 'p-accent')).toBe('#60a5fa')
    expect(r.tokens.active!.modes.get('dim')!.get('p-accent')!.layers[0]).toMatchObject({ source: 'theme', theme: 'ink', mode: 'dark' })
  })

  it('токен из одного режима получает значение в каждом — из режима по умолчанию', () => {
    const data = themeData('solo', { light: { 'p-bg': '#fff', 'p-only': 'x' }, dark: { 'p-bg': '#000' } })
    const r = resolve(data)
    expect(resolveTokenValue(r, 'dark', 'p-only')).toBe('x')
    expect(r.tokens.active!.modes.get('dark')!.get('p-only')!.layers[0]!.mode).toBe('light')
  })
})

describe('токены компонентов (A-24)', () => {
  it('по токену: сначала режим и его предки, внутри — цепочка тем', () => {
    const r = resolve('ink')
    // ink-light: своё значение темы ink.
    expect(resolveTokenValue(r, 'light', 'b-shadow')).toBe('line')
    // ink-dark: у ink нет dark — берётся paper/dark, а не ink/light.
    expect(resolveTokenValue(r, 'dark', 'b-shadow')).toBe('none')
    // ink-dim: dim → dark → paper/dark.
    expect(resolveTokenValue(r, 'dim', 'b-shadow')).toBe('none')
    expect(r.tokens.active!.modes.get('dim')!.get('b-shadow')!.layers[0]).toMatchObject({ source: 'component', theme: 'paper', mode: 'dark', componentKey: '@p/ui:Button' })
    // Токен только в режиме по умолчанию — во всех режимах.
    expect(resolveTokenValue(r, 'dim', 'b-bg')).toBe('var(--p-accent)')
    // root — по цепочке тем.
    expect(r.tokens.active!.root.get('b-gap')!.layers[0]).toMatchObject({ theme: 'paper', mode: 'root' })
  })

  it('компонент без токенов для цепочки активной темы ничего не даёт', () => {
    const r = resolve('paper', undefined, [ui({ Chart: { ink: { modes: { light: { 'c-grid': '#ccc' } } } } })])
    expect(resolveTokenValue(r, 'light', 'c-grid')).toBeUndefined()
    expect(resolveTokenValue(resolve('ink', undefined, [ui({ Chart: { ink: { modes: { light: { 'c-grid': '#ccc' } } } } })]), 'light', 'c-grid')).toBe('#ccc')
  })

  it('тема-объект приложения перекрывает токены компонентов (A-27) и наследует их через extends', () => {
    const brand = { ...themeData('brand', { light: { 'p-bg': '#fafafa', 'b-shadow': 'brand' }, dark: { 'p-bg': '#111' } }), extends: 'ink' }
    const r = resolve(brand)
    const chain = r.tokens.active!.modes.get('light')!.get('b-shadow')!
    expect(chain.layers.map(l => l.source)).toEqual(['component', 'app-theme'])
    expect(chain.effective).toBe('brand')
    expect(resolveTokenValue(r, 'dark', 'b-shadow')).toBe('none')
  })
})

describe('режимы приложения и override (T-7 слои 4–5)', () => {
  it('define берёт итог базы и дописывает своё', () => {
    const r = resolve('paper', { define: { ocean: { extends: 'dark', tokens: { 'p-accent': '#0ea5e9' } } } })
    expect(resolveTokenValue(r, 'ocean', 'p-accent')).toBe('#0ea5e9')
    expect(resolveTokenValue(r, 'ocean', 'b-shadow')).toBe('none')
    expect(r.tokens.active!.modes.get('ocean')!.get('p-accent')!.layers.at(-1)).toMatchObject({ source: 'app-mode', mode: 'ocean' })
  })

  it('tokenOverrides: root — в корень, режим — в режим; последний слой', () => {
    const r = resolve('paper', { tokenOverrides: { root: { 'p-radius': '3px' }, dark: { 'p-bg': '#050505' } } })
    expect(r.tokens.active!.root.get('p-radius')!.effective).toBe('3px')
    expect(resolveTokenValue(r, 'dark', 'p-bg')).toBe('#050505')
    expect(resolveTokenValue(r, 'light', 'p-bg')).toBe('#ffffff')
    expect(describeLayer(r.tokens.active!.modes.get('dark')!.get('p-bg')!.layers.at(-1)!)).toBe('app override')
  })

  it('strictTokens отбрасывает override неизвестного токена — с предупреждением и слоем skipped', () => {
    const r = resolve('paper', { strictTokens: true, tokenOverrides: { light: { 'p-bg': '#eee', 'nobody': '1' } } })
    expect(resolveTokenValue(r, 'light', 'nobody')).toBeUndefined()
    expect(r.tokens.active!.modes.get('light')!.get('nobody')!.layers[0]!.skipped).toBe('strict-tokens')
    expect(resolveTokenValue(r, 'light', 'p-bg')).toBe('#eee')
    expect(r.warnings).toContainEqual({ kind: 'override-skipped', mode: 'light', token: 'nobody' })
  })
})

describe('превью (A-32)', () => {
  it('полный набор своей темы; значение превью — по id темы', () => {
    const r = resolve('ink', undefined, [BUTTON])
    const withPreview = resolveGranum({ providers: [OWNER, BUTTON], theme: 'ink', previews: ['paper'], themeData: { '@p/ds': { paper: PAPER, ink: INK } } })
    expect(withPreview.tokens.previews.map(p => p.themeId)).toEqual(['paper'])
    expect(resolveTokenValue(withPreview, 'light', 'b-shadow', 'paper')).toBe('soft')
    expect(resolveTokenValue(r, 'light', 'b-shadow')).toBe('line')
  })
})
