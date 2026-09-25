import type { GranumThemeManifest, GranumThemeTarget } from '../runtime'
import { describe, expect, it, vi } from 'vitest'
import { resolveGranum } from '../core/resolve'
import { getThemeManifest } from '../node/themeManifest'
import { createThemeController, resolveThemeActivation } from '../runtime'
import { makeProvider } from './helpers'

function createTarget(): GranumThemeTarget & { classes: Set<string>, attributes: Map<string, string> } {
  const classes = new Set<string>()
  const attributes = new Map<string, string>()
  return {
    classes,
    attributes,
    classList: { add: t => void classes.add(t), remove: t => void classes.delete(t), contains: t => classes.has(t) },
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => void attributes.set(name, value),
    removeAttribute: name => void attributes.delete(name),
  }
}

function manifestOf(themes: GranumThemeManifest['themes']): GranumThemeManifest {
  return { themes, defaultTheme: themes[0]!.name }
}

describe('resolveThemeActivation', () => {
  it('корень, класс, атрибут в любых кавычках; приоритет атрибут → класс → корень; невыводимые — unknown', () => {
    expect(resolveThemeActivation([':root'])).toEqual({ type: 'root' })
    expect(resolveThemeActivation(['html'])).toEqual({ type: 'root' })
    expect(resolveThemeActivation(['.dark'])).toEqual({ type: 'class', value: 'dark' })
    expect(resolveThemeActivation(['[data-theme="dark"]'])).toEqual({ type: 'attribute', name: 'data-theme', value: 'dark' })
    expect(resolveThemeActivation(['[data-theme=\'hc\']'])).toEqual({ type: 'attribute', name: 'data-theme', value: 'hc' })
    expect(resolveThemeActivation(['[data-theme=sepia]'])).toEqual({ type: 'attribute', name: 'data-theme', value: 'sepia' })
    expect(resolveThemeActivation(['.theme-dark, .dark, [data-theme="dark"]'])).toEqual({ type: 'attribute', name: 'data-theme', value: 'dark' })
    expect(resolveThemeActivation([':root', '.dark'])).toEqual({ type: 'class', value: 'dark' })
    for (const bad of [[], ['.a .b'], ['[data-theme]'], ['@media (min-width: 100px)']])
      expect(resolveThemeActivation(bad)).toEqual({ type: 'unknown' })
  })
})

describe('getThemeManifest — из той же резолюции, что и CSS (T-4, RT-2)', () => {
  const provider = makeProvider('ds', {
    theme: {
      defaultThemes: ['light', 'dark'],
      tokenDefinitions: {
        light: { selector: ':root', tokens: { brd: '#eee' } },
        dark: { selector: '.dark, [data-theme="dark"]', tokens: { brd: '#333' } },
      },
    },
  })

  it('имена, селекторы и активации', () => {
    const manifest = getThemeManifest(resolveGranum({ providers: [provider] }))
    expect(manifest.defaultTheme).toBe('light')
    expect(manifest.themes.map(t => t.name)).toEqual(['light', 'dark'])
    expect(manifest.themes[0]!.activation).toEqual({ type: 'root' })
    expect(manifest.themes[1]!.selectors).toEqual(['.dark, [data-theme="dark"]'])
    expect(manifest.themes[1]!.activation).toEqual({ type: 'attribute', name: 'data-theme', value: 'dark' })
    expect(manifest.themes[0]!.tokens).toBeUndefined()
  })

  it('includeTokens отдаёт значения после tokenOverrides; вложенный override создаёт селектор', () => {
    const r = resolveGranum({ providers: [provider], themes: { names: ['light'], tokenOverrides: { light: { brd: '#000' } } } })
    expect(getThemeManifest(r, { includeTokens: true }).themes[0]!.tokens).toEqual({ ':root': { brd: '#000' } })
    const nested = resolveGranum({ providers: [provider], themes: { names: ['dark'], tokenOverrides: { dark: { '[data-mode="hc"]': { brd: '#000' } } } } })
    const dark = getThemeManifest(nested, { includeTokens: true }).themes[0]!
    expect(dark.selectors).toContain('[data-mode="hc"]')
    expect(dark.tokens!['[data-mode="hc"]']).toEqual({ brd: '#000' })
    const only = resolveGranum({ providers: [provider], themes: { names: ['brand'], tokenOverrides: { brand: { accent: '#f0f' } } } })
    expect(getThemeManifest(only, { includeTokens: true }).themes[0]!.tokens).toEqual({ ':root': { accent: '#f0f' } })
  })

  it('тема из CSS-файла даёт unknown, но чинится явной активацией', () => {
    const fileThemed = makeProvider('file', { theme: { defaultThemes: ['dark'], themes: { dark: 'theme/dark.css' } } })
    const r = resolveGranum({ providers: [fileThemed] })
    expect(getThemeManifest(r).themes[0]!.activation).toEqual({ type: 'unknown' })
    expect(getThemeManifest(r, { activations: { dark: { type: 'class', value: 'dark' } } }).themes[0]!.activation).toEqual({ type: 'class', value: 'dark' })
  })

  it('label и colorScheme из themes.define доезжают', () => {
    const r = resolveGranum({ providers: [provider], themes: { define: { emerald: { extends: 'light', tokens: { bg: '#052e1f' }, label: 'Изумруд', colorScheme: 'dark' } } } })
    expect(getThemeManifest(r).themes).toEqual([{
      name: 'emerald',
      selectors: ['[data-theme="emerald"]'],
      activation: { type: 'attribute', name: 'data-theme', value: 'emerald' },
      label: 'Изумруд',
      colorScheme: 'dark',
    }])
  })
})

describe('createThemeController', () => {
  const manifest = manifestOf([
    { name: 'light', selectors: [':root'], activation: { type: 'root' } },
    { name: 'dark', selectors: ['.dark'], activation: { type: 'class', value: 'dark' } },
    { name: 'hc', selectors: ['[data-theme="hc"]'], activation: { type: 'attribute', name: 'data-theme', value: 'hc' } },
  ])
  const setup = (options = {}): { target: ReturnType<typeof createTarget>, controller: ReturnType<typeof createThemeController> } => {
    const target = createTarget()
    return { target, controller: createThemeController(manifest, { target, storage: null, ...options }) }
  }

  it('старт, переключение, снятие предыдущей, чужой атрибут не трогается, cycle, подписки', () => {
    const { target, controller } = setup()
    expect(controller.get()).toBe('light')
    expect(controller.list()).toEqual(['light', 'dark', 'hc'])
    controller.set('dark')
    expect(target.classes.has('dark')).toBe(true)
    controller.set('hc')
    expect(target.classes.has('dark')).toBe(false)
    expect(target.attributes.get('data-theme')).toBe('hc')
    controller.set('light')
    expect(target.classes.size).toBe(0)
    expect(target.attributes.has('data-theme')).toBe(false)

    target.attributes.set('data-theme', 'своё')
    controller.set('dark')
    expect(target.attributes.get('data-theme')).toBe('своё')

    expect(controller.cycle()).toBe('hc')
    expect(controller.cycle()).toBe('light')
    const seen: string[] = []
    const off = controller.subscribe(name => seen.push(name))
    controller.set('dark')
    off()
    controller.set('hc')
    expect(seen).toEqual(['dark'])
  })

  it('ошибки: неизвестная тема, невыводимая активация, пустой манифест', () => {
    const { controller } = setup()
    expect(() => controller.set('nope')).toThrow(/light, dark, hc/)
    const broken = manifestOf([{ name: 'light', selectors: [':root'], activation: { type: 'root' } }, { name: 'dark', selectors: [], activation: { type: 'unknown' } }])
    expect(() => createThemeController(broken, { target: createTarget(), storage: null }).set('dark')).toThrow(/tokenDefinitions|activations/)
    expect(() => createThemeController({ themes: [], defaultTheme: '' })).toThrow(/manifest is empty/)
  })

  it('хранилище, системная схема, явный initial', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    createThemeController(manifest, { target: createTarget(), storage }).set('hc')
    const target = createTarget()
    expect(createThemeController(manifest, { target, storage }).get()).toBe('hc')
    expect(target.attributes.get('data-theme')).toBe('hc')
    expect(setup({ prefersDark: () => true }).controller.get()).toBe('dark')
    expect(setup({ prefersDark: () => false }).controller.get()).toBe('light')
    expect(setup({ storage: { getItem: () => 'dark', setItem: vi.fn() }, prefersDark: () => true, initial: 'hc' }).controller.get()).toBe('hc')
  })
})
