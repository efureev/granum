import type { GranumResolveInput } from '../core/resolve'
import { describe, expect, it } from 'vitest'
import { resolveGranum, resolveTokenValue } from '../core/resolve'
import { makeManifest, makeProvider, themeData } from './helpers'

const ds = makeProvider('ds', {
  theme: { defaultTheme: 'paper', catalog: { paper: { title: 'Бумага', data: 'themes/paper.json' } } },
  components: [
    { name: 'DsButton', safelist: ['ds-btn'], cssFiles: ['components/DsButton/styles.css'] },
    { name: 'DsCard', dependencies: ['DsButton'], themesDir: 'components/DsCard/themes' },
  ],
})

/** Данные темы и токены `themesDir` объектной формы приносит node-слой; здесь — литералами. */
const THEMES = {
  themeData: { ds: { paper: themeData('paper', { light: { bg: '#fff' } }, { root: { radius: '4px' } }) } },
  componentThemes: { ds: { DsCard: { paper: { modes: { light: { card: '#eee' } } } } } },
}

const heavy = makeManifest('@x/heavy', {
  XhPanel: { classes: ['flex', 'gap-2'], dependencies: ['ds:DsCard'], css: ['components/XhPanel/styles.css'], safelist: ['p-2'] },
}, { dependencies: ['ds'] })

describe('resolveGranum', () => {
  it('одна Resolution на объект входа: мемоизация по идентичности', () => {
    const input: GranumResolveInput = { providers: [ds, heavy], components: ['@x/heavy:XhPanel'], ...THEMES }
    const a = resolveGranum(input)
    expect(resolveGranum(input)).toBe(a)
    expect(resolveGranum({ ...input })).not.toBe(a)
  })

  it('смешанный вход: манифест + объект; все каналы из одной резолюции', () => {
    const r = resolveGranum({ providers: [ds, heavy], components: ['@x/heavy:XhPanel'], ...THEMES })
    expect(r.providers.map(p => `${p.form}:${p.id}`)).toEqual(['object:ds', 'manifest:@x/heavy'])
    expect(r.selection.order).toEqual(['ds:DsButton', 'ds:DsCard', '@x/heavy:XhPanel'])
    expect(r.classes).toEqual(['flex', 'gap-2'])
    expect(r.safelist).toEqual(['ds-btn', 'p-2'])
    expect(r.componentCss).toEqual([
      { providerId: 'ds', componentName: 'DsButton', path: 'components/DsButton/styles.css' },
      { providerId: '@x/heavy', componentName: 'XhPanel', path: 'components/XhPanel/styles.css' },
    ])
    expect(r.themes.default?.theme.id).toBe('paper')
    expect(r.themes.themeSource).toBe('default')
    expect(r.themes.default?.modes.map(m => m.name)).toEqual(['light'])
    expect(resolveTokenValue(r, 'light', 'card')).toBe('#eee')
    expect(resolveTokenValue(r, 'light', 'bg')).toBe('#fff')
    expect(resolveTokenValue(r, 'light', 'radius')).toBe('4px')
    expect(resolveTokenValue(r, 'light', 'nope')).toBeUndefined()
    expect(resolveTokenValue(r, 'dark', 'bg')).toBeUndefined()
  })

  it('объектная форма помечается предупреждением provider-without-manifest', () => {
    const r = resolveGranum({ providers: [ds, heavy], ...THEMES })
    expect(r.warnings).toContainEqual({ kind: 'provider-without-manifest', providerId: 'ds' })
    expect(r.warnings.filter(w => w.kind === 'provider-without-manifest')).toHaveLength(1)
  })

  it('strictTokens: отброшенный override — предупреждение, а не console.warn', () => {
    const r = resolveGranum({
      providers: [ds],
      ...THEMES,
      themes: [{ theme: 'paper', modes: { strictTokens: true, tokenOverrides: { light: { bg: '#000', ghost: '#123' } } } }],
    })
    expect(r.warnings).toContainEqual({ kind: 'override-skipped', theme: 'paper', mode: 'light', token: 'ghost' })
    expect(resolveTokenValue(r, 'light', 'bg')).toBe('#000')
    expect(resolveTokenValue(r, 'light', 'ghost')).toBeUndefined()
    const loose = resolveGranum({ providers: [ds], ...THEMES, themes: [{ theme: 'paper', modes: { tokenOverrides: { light: { ghost: '#123' } } } }] })
    expect(resolveTokenValue(loose, 'light', 'ghost')).toBe('#123')
  })

  it('предупреждения тем доезжают до резолюции', () => {
    const r = resolveGranum({ providers: [ds], ...THEMES, componentThemes: { ds: { DsCard: { clay: { modes: {} } } } } })
    expect(r.warnings).toContainEqual({ kind: 'component-theme-unknown', providerId: 'ds', component: 'DsCard', theme: 'clay' })
  })

  it('чистота: вход не мутируется, повторный вызов с равным входом даёт глубоко равный результат', () => {
    const make = (): GranumResolveInput => ({
      providers: [makeProvider('ds', { components: ds.components, theme: ds.theme! }), makeManifest('@x/heavy', { XhPanel: heavy.manifest.components.XhPanel! }, { dependencies: ['ds'] })],
      components: ['@x/heavy:XhPanel'],
      ...THEMES,
      themes: [{ theme: 'paper', modes: { tokenOverrides: { light: { bg: '#000' } } } }],
    })
    const input = make()
    const snapshot = JSON.stringify(input)
    const a = resolveGranum(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    const b = resolveGranum(make())
    expect(b.selection.order).toEqual(a.selection.order)
    expect(b.classes).toEqual(a.classes)
    expect(b.themes).toEqual(a.themes)
    expect([...b.tokens.default!.modes.keys()]).toEqual([...a.tokens.default!.modes.keys()])
  })

  it('порядок providers во входе не меняет ни классы, ни safelist, ни CSS при одинаковом графе', () => {
    const forward = resolveGranum({ providers: [ds, heavy], components: 'all', ...THEMES })
    const backward = resolveGranum({ providers: [heavy, ds], components: 'all', ...THEMES })
    expect(backward.classes).toEqual(forward.classes)
    expect(backward.safelist).toEqual(forward.safelist)
    expect([...backward.selection.order].sort()).toEqual([...forward.selection.order].sort())
    // Порядок эмиссии CSS следует графу и селекции — он детерминирован, но
    // зависит от порядка корней; это нормативно, не случайность.
    expect(backward.componentCss.map(c => c.path).sort()).toEqual(forward.componentCss.map(c => c.path).sort())
  })
})

describe('resolveGranum: порядок провайдеров', () => {
  it('донор по строковой зависимости раньше зависящего, хотя в конфиге стоит позже', () => {
    const ui = makeManifest('@x/ui', { Card: {} }, { dependencies: ['@x/base'] })
    const base = makeManifest('@x/base', { Box: {} })
    const resolution = resolveGranum({ providers: [ui, base], components: 'all' })
    expect(resolution.providers.map(p => p.id)).toEqual(['@x/base', '@x/ui'])
  })
})
