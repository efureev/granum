import type { GranumResolveInput } from '../core/resolve'
import { describe, expect, it } from 'vitest'
import { resolveGranum, resolveTokenValue } from '../core/resolve'
import { makeManifest, makeProvider } from './helpers'

const ds = makeProvider('ds', {
  theme: {
    defaultThemes: ['light'],
    tokenDefinitions: { light: { selector: ':root', tokens: { bg: '#fff', radius: '4px' } } },
  },
  components: [
    { name: 'DsButton', safelist: ['ds-btn'], cssFiles: ['components/DsButton/styles.css'] },
    { name: 'DsCard', dependencies: ['DsButton'], tokenDefinitions: { light: { tokens: { card: '#eee' } } } },
  ],
})

const heavy = makeManifest('@x/heavy', {
  XhPanel: { classes: ['flex', 'gap-2'], dependencies: ['ds:DsCard'], css: ['components/XhPanel/styles.css'], safelist: ['p-2'] },
}, { dependencies: ['ds'] })

describe('resolveGranum (R-1…R-6)', () => {
  it('одна Resolution на объект входа: мемоизация по идентичности (INV-RES-1)', () => {
    const input: GranumResolveInput = { providers: [ds, heavy], components: ['@x/heavy:XhPanel'] }
    const a = resolveGranum(input)
    expect(resolveGranum(input)).toBe(a)
    expect(resolveGranum({ ...input })).not.toBe(a)
  })

  it('смешанный вход: манифест + объект; все каналы из одной резолюции (R-2)', () => {
    const r = resolveGranum({ providers: [ds, heavy], components: ['@x/heavy:XhPanel'] })
    expect(r.providers.map(p => `${p.form}:${p.id}`)).toEqual(['object:ds', 'manifest:@x/heavy'])
    expect(r.selection.order).toEqual(['ds:DsButton', 'ds:DsCard', '@x/heavy:XhPanel'])
    expect(r.classes).toEqual(['flex', 'gap-2'])
    expect(r.safelist).toEqual(['ds-btn', 'p-2'])
    expect(r.componentCss).toEqual([
      { providerId: 'ds', componentName: 'DsButton', path: 'components/DsButton/styles.css' },
      { providerId: '@x/heavy', componentName: 'XhPanel', path: 'components/XhPanel/styles.css' },
    ])
    expect(r.themes.names).toEqual(['light'])
    expect(r.themes.namesSource).toBe('provider-defaults')
    expect(resolveTokenValue(r, 'light', 'card')).toBe('#eee')
    expect(resolveTokenValue(r, 'light', 'bg', ':root')).toBe('#fff')
    expect(resolveTokenValue(r, 'light', 'nope')).toBeUndefined()
    expect(resolveTokenValue(r, 'dark', 'bg')).toBeUndefined()
  })

  it('объектная форма помечается предупреждением provider-without-manifest (R-6)', () => {
    const r = resolveGranum({ providers: [ds, heavy] })
    expect(r.warnings).toContainEqual({ kind: 'provider-without-manifest', providerId: 'ds' })
    expect(r.warnings.filter(w => w.kind === 'provider-without-manifest')).toHaveLength(1)
  })

  it('strictTokens: отброшенный override — предупреждение, а не console.warn (INV-THM-3, INV-DIAG-3)', () => {
    const r = resolveGranum({
      providers: [ds],
      themes: { strictTokens: true, tokenOverrides: { light: { bg: '#000', ghost: '#123' } } },
    })
    expect(r.warnings).toContainEqual({ kind: 'override-skipped', theme: 'light', token: 'ghost' })
    expect(resolveTokenValue(r, 'light', 'bg')).toBe('#000')
    expect(resolveTokenValue(r, 'light', 'ghost')).toBeUndefined()
    const loose = resolveGranum({ providers: [ds], themes: { tokenOverrides: { light: { ghost: '#123' } } } })
    expect(resolveTokenValue(loose, 'light', 'ghost')).toBe('#123')
  })

  it('предупреждения тем доезжают до резолюции', () => {
    const r = resolveGranum({ providers: [makeProvider('p', { theme: { defaultThemes: ['dark'] } })] })
    expect(r.warnings).toContainEqual({ kind: 'default-theme-without-source', providerId: 'p', theme: 'dark' })
  })

  it('чистота: вход не мутируется, повторный вызов с равным входом даёт глубоко равный результат (INV-RES-2)', () => {
    const make = (): GranumResolveInput => ({
      providers: [makeProvider('ds', { components: ds.components, theme: ds.theme! }), makeManifest('@x/heavy', { XhPanel: heavy.manifest.components.XhPanel! }, { dependencies: ['ds'] })],
      components: ['@x/heavy:XhPanel'],
      themes: { tokenOverrides: { light: { bg: '#000' } } },
    })
    const input = make()
    const snapshot = JSON.stringify(input)
    const a = resolveGranum(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    const b = resolveGranum(make())
    expect(b.selection.order).toEqual(a.selection.order)
    expect(b.classes).toEqual(a.classes)
    expect(b.themes).toEqual(a.themes)
    expect([...b.tokenLayers.keys()]).toEqual([...a.tokenLayers.keys()])
  })

  it('порядок providers во входе не меняет ни классы, ни safelist, ни CSS при одинаковом графе (INV-DET-3)', () => {
    const forward = resolveGranum({ providers: [ds, heavy], components: 'all' })
    const backward = resolveGranum({ providers: [heavy, ds], components: 'all' })
    expect(backward.classes).toEqual(forward.classes)
    expect(backward.safelist).toEqual(forward.safelist)
    expect([...backward.selection.order].sort()).toEqual([...forward.selection.order].sort())
    // Порядок эмиссии CSS следует графу и селекции — он детерминирован, но
    // зависит от порядка корней; это нормативно (INV-CSS-2), не случайность.
    expect(backward.componentCss.map(c => c.path).sort()).toEqual(forward.componentCss.map(c => c.path).sort())
  })
})
