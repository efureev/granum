import type { GranumProvider } from '../contract'
import { describe, expect, it } from 'vitest'
import { toProviderNode } from '../core/providerNode'
import { defaultAppThemeSelector, GRANUM_DEFAULT_THEME_NAMES, resolveNeededThemeNames, resolveThemes } from '../core/resolveThemes'
import { makeManifest, makeProvider } from './helpers'

const nodes = (...ps: Parameters<typeof toProviderNode>[0][]): ReturnType<typeof toProviderNode>[] => ps.map(toProviderNode)
const comps = (p: GranumProvider): ReturnType<typeof toProviderNode>['components'] => toProviderNode(p).components

const providerA = makeProvider('a', { theme: { themes: { light: 'theme/light.css', dark: 'theme/dark.css' } } })
const providerB = makeProvider('b', { theme: { themes: { light: 'theme/light.css' } } })
const providerStructural = makeProvider('s', {
  theme: {
    tokenDefinitions: {
      light: { selector: ':root', tokens: { 'primary-color': 'blue', 'radius': '4px' } },
      dark: { selector: '[data-theme="dark"]', tokens: { 'primary-color': 'lightblue' } },
    },
  },
})

describe('resolveThemes', () => {
  it('по умолчанию — только light', () => {
    const r = resolveThemes(nodes(providerA, providerB))
    expect(r.names).toEqual(GRANUM_DEFAULT_THEME_NAMES)
    expect(r.items.map(i => `${i.providerId}:${i.themeName}`)).toEqual(['a:light', 'b:light'])
  })

  it('пустой массив — тем нет', () => {
    expect(resolveThemes(nodes(providerA, providerB), { names: [] }).items).toEqual([])
  })

  it('пересечение × имена, пропуск отсутствующих; провайдер без темы — игнор', () => {
    const r = resolveThemes(nodes(providerA, providerB), { names: ['light', 'dark'] })
    expect(r.items.map(i => `${i.providerId}:${i.themeName}`)).toEqual(['a:light', 'a:dark', 'b:light'])
    expect(resolveThemes(nodes(makeProvider('n'), providerA), { names: ['light'] }).items)
      .toEqual([{ providerId: 'a', themeName: 'light', cssRef: 'theme/light.css' }])
  })

  it('tokenDefinitions побеждает themes у одного провайдера (INV-THM-4)', () => {
    const mixed = makeProvider('m', { theme: { themes: { light: 'l.css' }, tokenDefinitions: { light: { tokens: { a: '1' } } } } })
    const r = resolveThemes(nodes(mixed), { names: ['light'] })
    expect(r.items[0]!.tokenDefinition).toBeDefined()
    expect(r.items[0]!.cssRef).toBeUndefined()
  })

  it('мержит токены из нескольких провайдеров; позже — важнее', () => {
    const s2 = makeProvider('s2', { theme: { tokenDefinitions: { light: { tokens: { 'secondary-color': 'red', 'radius': '8px' } } } } })
    const r = resolveThemes(nodes(providerStructural, s2), { names: ['light'] })
    expect(r.tokenRegistry.light!.tokens).toEqual({ 'primary-color': 'blue', 'secondary-color': 'red', 'radius': '8px' })
    expect(r.tokenRegistry.light!.selector).toBe(':root')
  })

  it('компоненты мержатся поверх провайдеров; неактивные темы игнорируются', () => {
    const p = makeProvider('s', {
      theme: providerStructural.theme!,
      components: [{
        name: 'XTokenized',
        tokenDefinitions: {
          light: { tokens: { 'x-tokenized': 'red', 'primary-color': 'green' } },
          dark: { tokens: { 'x-tokenized': 'yellow' } },
        },
      }],
    })
    const r = resolveThemes(nodes(p), { names: ['light', 'dark'] }, comps(p))
    expect(r.tokenRegistry.light!.tokens).toEqual({ 'primary-color': 'green', 'radius': '4px', 'x-tokenized': 'red' })
    expect(r.tokenRegistry.dark!.tokens).toEqual({ 'primary-color': 'lightblue', 'x-tokenized': 'yellow' })
    expect(r.items.find(i => i.componentName === 'XTokenized' && i.themeName === 'light')!.tokenDefinition!.tokens['x-tokenized']).toBe('red')

    const only = resolveThemes([], { names: ['light'] }, comps(p))
    expect(only.tokenRegistry.light!.tokens).toEqual({ 'x-tokenized': 'red', 'primary-color': 'green' })
    expect(only.tokenRegistry.dark).toBeUndefined()
    expect(only.items.every(i => i.themeName !== 'dark')).toBe(true)
  })

  it('разные селекторы одной темы — отдельные блоки; безселекторный вклад — в первичный', () => {
    const p1 = makeProvider('p1', {
      theme: { tokenDefinitions: { dark: { selector: '.dark', tokens: { a: '1' } } } },
      components: [{ name: 'X', tokenDefinitions: { dark: { tokens: { b: '2' } } } }],
    })
    const p2 = makeProvider('p2', { theme: { tokenDefinitions: { dark: { selector: '[data-theme="dark"]', tokens: { c: '3' } } } } })
    const r = resolveThemes(nodes(p1, p2), { names: ['dark'] }, comps(p1))
    expect(r.tokenRegistry.dark!.blocks).toEqual([
      { selector: '.dark', tokens: { a: '1', b: '2' } },
      { selector: '[data-theme="dark"]', tokens: { c: '3' } },
    ])
    expect(r.tokenRegistry.dark!.selector).toBe('.dark')
  })

  it('компонент создаёт тему с нуля, если у провайдеров её нет', () => {
    const p = makeProvider('a', { components: [{ name: 'X', tokenDefinitions: { light: { selector: ':root', tokens: { x: 'red' } } } }] })
    const r = resolveThemes(nodes(providerA), { names: ['light'] }, comps(p))
    expect(r.tokenRegistry.light!.tokens.x).toBe('red')
  })

  it('манифестная форма: темы, токены и defaultThemes читаются из манифеста', () => {
    const m = makeManifest('@x/h', {
      XhCard: { tokens: { declares: { light: { tokens: { card: '#fff' } } }, consumes: [], dynamic: [] } },
    }, {
      theme: {
        themes: { dark: 'theme/dark.css' },
        defaultThemes: ['light', 'dark'],
        tokenDefinitions: { light: { tokens: { bg: '#fff' } } },
        declares: ['--bg'],
      },
    })
    const node = toProviderNode(m)
    const r = resolveThemes([node], {}, node.components)
    expect(r.names).toEqual(['light', 'dark'])
    expect(r.namesSource).toBe('provider-defaults')
    expect(r.tokenRegistry.light!.tokens).toEqual({ bg: '#fff', card: '#fff' })
    expect(r.items.find(i => i.themeName === 'dark')!.cssRef).toBe('theme/dark.css')
  })
})

describe('defaultThemes провайдеров (INV-THM-1)', () => {
  const mk = (id: string, defaults: string[] | undefined, themes: Record<string, string>): GranumProvider =>
    makeProvider(id, { theme: { themes, ...(defaults ? { defaultThemes: defaults } : {}) } })

  it('без names — из defaultThemes, объединение в порядке провайдеров с дедупом', () => {
    const r = resolveThemes(nodes(mk('p', ['brand-day'], { 'brand-day': 'day.css' })))
    expect(r.names).toEqual(['brand-day'])
    expect(r.namesSource).toBe('provider-defaults')
    const p1 = mk('p1', ['light', 'dark'], { light: 'l', dark: 'd' })
    const p2 = mk('p2', ['dark', 'hc'], { dark: 'd', hc: 'h' })
    expect(resolveThemes(nodes(p1, p2)).names).toEqual(['light', 'dark', 'hc'])
  })

  it('никто не объявил — фолбэк light; явные names перебивают; names: [] — тем нет', () => {
    expect(resolveThemes(nodes(mk('p', undefined, { light: 'l' }))).namesSource).toBe('fallback')
    const p = mk('p', ['dark'], { light: 'l', dark: 'd' })
    expect(resolveThemes(nodes(p), { names: ['light'] })).toMatchObject({ names: ['light'], namesSource: 'explicit' })
    expect(resolveThemes(nodes(p), { names: [] })).toMatchObject({ names: [], items: [] })
  })

  it('предупреждения: без источника, частичная тема, несколько дефолтных', () => {
    expect(resolveThemes(nodes(mk('p', ['dark'], { light: 'l' }))).warnings)
      .toContainEqual({ kind: 'default-theme-without-source', providerId: 'p', theme: 'dark' })
    expect(resolveThemes(nodes(providerA, providerB), { names: ['dark'] }).warnings)
      .toContainEqual({ kind: 'partial-theme', theme: 'dark', providersWithout: ['b'] })
    expect(resolveThemes(nodes(mk('p', ['light', 'dark'], { light: 'l', dark: 'd' }))).warnings)
      .toContainEqual({ kind: 'multiple-default-themes', themes: ['light', 'dark'] })
    expect(resolveThemes(nodes(mk('p', ['light'], { light: 'l' }))).warnings).toEqual([])
  })

  it('тема, поставляемая только компонентом или только ссылкой, не считается «без источника»', () => {
    const byComponent = makeProvider('p', {
      components: [{ name: 'X', tokenDefinitions: { dark: { selector: '.dark', tokens: { brd: '#000' } } } }],
      theme: { defaultThemes: ['dark'] },
    })
    expect(resolveThemes(nodes(byComponent))).toMatchObject({ names: ['dark'], warnings: [] })
    const byRef = makeProvider('q', { theme: { defaultThemes: ['dark'], tokenDefinitionsRef: { dark: 'file:///q/dark.css' } } })
    expect(resolveThemes(nodes(byRef)).warnings).toEqual([])
  })
})

describe('themes.define — набор тем принадлежит приложению', () => {
  const structural = makeProvider('ds', {
    theme: {
      defaultThemes: ['light', 'dark'],
      tokenDefinitions: {
        light: { selector: ':root', tokens: { bg: '#fff', fg: '#000', radius: '4px' } },
        dark: { selector: '.dark', tokens: { bg: '#000', fg: '#fff' } },
      },
    },
  })
  const opaque = makeProvider('op', { theme: { themes: { legacy: 'legacy.css' } } })

  it('без names набор тем равен ключам define', () => {
    const r = resolveThemes(nodes(structural), {
      define: { emerald: { extends: 'light', tokens: { bg: '#052e1f' } }, crimson: { extends: 'light', tokens: { bg: '#450a0a' } } },
    })
    expect(r.names).toEqual(['emerald', 'crimson'])
    expect(r.namesSource).toBe('app-defined')
    expect(Object.keys(r.tokenRegistry)).toEqual(['emerald', 'crimson'])
  })

  it('единственная тема под :root; явный names перебивает define', () => {
    const r = resolveThemes(nodes(structural), { define: { brand: { extends: 'dark', selector: ':root', tokens: { fg: '#eee' } } } })
    expect(r.tokenRegistry.brand!.blocks).toEqual([{ selector: ':root', tokens: { bg: '#000', fg: '#eee' } }])
    const e = resolveThemes(nodes(structural), { names: ['light'], define: { emerald: { extends: 'light' } } })
    expect(e.names).toEqual(['light'])
    expect(e.tokenRegistry.emerald).toBeUndefined()
  })

  it('extends: база резолвится, но в сборку не попадает; токены переезжают под селектор новой темы', () => {
    const r = resolveThemes(nodes(structural), { names: ['emerald'], define: { emerald: { extends: 'light', tokens: { bg: '#052e1f' } } } })
    expect(r.tokenRegistry.light).toBeUndefined()
    expect(r.tokenRegistry.emerald!.tokens).toEqual({ bg: '#052e1f', fg: '#000', radius: '4px' })
    const o = resolveThemes(nodes(structural), { names: ['ocean'], define: { ocean: { extends: 'dark', tokens: { bg: '#082f49' } } } })
    expect(o.tokenRegistry.ocean!.blocks).toEqual([{ selector: defaultAppThemeSelector('ocean'), tokens: { bg: '#082f49', fg: '#fff' } }])
    expect(resolveNeededThemeNames(nodes(structural), { names: ['ocean'], define: { ocean: { extends: 'dark' } } })).toEqual(new Set(['ocean', 'dark']))
  })

  it('цепочка extends: базы раньше наследников; define без extends — точечный мерж', () => {
    const r = resolveThemes(nodes(structural), {
      names: ['ocean-hc'],
      define: { 'ocean': { extends: 'light', tokens: { bg: '#082f49' } }, 'ocean-hc': { extends: 'ocean', tokens: { fg: '#ffffff' } } },
    })
    expect(r.tokenRegistry['ocean-hc']!.tokens).toEqual({ bg: '#082f49', fg: '#ffffff', radius: '4px' })
    const d = resolveThemes(nodes(structural), { names: ['dark'], define: { dark: { tokens: { bg: '#111' } } } })
    expect(d.tokenRegistry.dark!.blocks).toEqual([{ selector: '.dark', tokens: { bg: '#111', fg: '#fff' } }])
  })

  it('диагностика: неизвестная база, непрозрачная база, цикл, partial-theme не для тем приложения', () => {
    expect(resolveThemes(nodes(structural), { names: ['e'], define: { e: { extends: 'lite', tokens: { bg: '#0' } } } }).warnings)
      .toContainEqual({ kind: 'theme-extends-unresolved', theme: 'e', base: 'lite', reason: 'unknown' })
    expect(resolveThemes(nodes(opaque), { names: ['e'], define: { e: { extends: 'legacy' } } }).warnings)
      .toContainEqual({ kind: 'theme-extends-unresolved', theme: 'e', base: 'legacy', reason: 'opaque' })
    const cyc = resolveThemes(nodes(structural), { names: ['a'], define: { a: { extends: 'b', tokens: { fg: '#1' } }, b: { extends: 'a', tokens: { bg: '#2' } } } })
    expect(cyc.warnings.some(w => w.kind === 'theme-extends-cycle')).toBe(true)
    expect(cyc.names).toEqual(['a'])
    const other = makeProvider('other', { theme: { tokenDefinitions: { light: { tokens: { accent: 'red' } } } } })
    const r = resolveThemes(nodes(structural, other), { names: ['emerald'], define: { emerald: { extends: 'light', tokens: { bg: '#0' } } } })
    expect(r.warnings.filter(w => w.kind === 'partial-theme')).toEqual([])
  })

  it('метаданные label/colorScheme — только для активных тем и только если объявлены', () => {
    const r = resolveThemes(nodes(structural), {
      names: ['emerald', 'light'],
      define: { emerald: { extends: 'light', label: 'Изумруд', colorScheme: 'dark' }, sand: { label: 'Песок' } },
    })
    expect(r.meta).toEqual({ emerald: { label: 'Изумруд', colorScheme: 'dark' } })
  })
})
