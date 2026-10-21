import type { GranumLoadedManifest } from '../contract'
import type { GranumAppTheme, ResolvedThemes, ResolveThemesInput } from '../core/resolveThemes'
import { describe, expect, it } from 'vitest'
import { ThemeDataError, ThemeResolutionError } from '../core/errors'
import { toProviderNode } from '../core/providerNode'
import { additionalThemes, planThemes, resolveThemes } from '../core/resolveThemes'
import { INK, makeManifest, PAPER, themeData } from './helpers'

/** Владелец каталога в форме манифеста: данные тем приходят резолверу отдельно (`themeData`). */
function owner(id = '@p/ds', defaultTheme: string | null = 'paper'): GranumLoadedManifest {
  return makeManifest(id, {}, {
    theme: {
      ...(defaultTheme !== null ? { defaultTheme } : {}),
      catalog: {
        paper: { title: 'Бумага', data: 'themes/paper.json', modes: ['light', 'dark'], defaultMode: 'light' },
        ink: { title: 'Чернила', extends: 'paper', data: 'themes/ink.json', modes: ['light', 'dark', 'dim'], defaultMode: 'light' },
      },
      declares: [],
    },
  })
}

const DATA = { '@p/ds': { paper: PAPER, ink: INK } }

function resolve(input: ResolveThemesInput = {}, providers: GranumLoadedManifest[] = [owner()]) {
  return resolveThemes(providers.map(toProviderNode), input, [], DATA)
}

/** Основная тема резолюции. */
function main(r: ResolvedThemes) {
  return r.default!
}

function reasonOf(run: () => unknown): string | undefined {
  try {
    run()
  }
  catch (error) {
    return error instanceof ThemeResolutionError ? error.reason : `not a ThemeResolutionError: ${(error as Error).message}`
  }
  return undefined
}

describe('значения тем и режимов молча не теряются', () => {
  const none = [makeManifest('@p/plain')]

  it('без тем активация — theme-missing; без неё тем просто нет', () => {
    expect(reasonOf(() => resolve({ activation: { system: 'media' } }, none))).toBe('theme-missing')
    expect(reasonOf(() => resolve({}, none))).toBeUndefined()
  })

  it('extends темы-объекта не из каталога — unknown-theme со списком доступных', () => {
    const brand: GranumAppTheme = { ...themeData('brand', { light: { a: '1' } }), extends: 'papr' }
    expect(reasonOf(() => resolve({ themes: [brand] }))).toBe('unknown-theme')
    expect(reasonOf(() => resolve({ themes: [{ theme: 'paper', default: true }, brand] }))).toBe('unknown-theme')
    expect(reasonOf(() => resolve({ themes: [brand] }, none))).toBe('unknown-theme')
    try {
      resolve({ themes: [brand] })
    }
    catch (error) {
      expect((error as ThemeResolutionError).available).toEqual(['paper', 'ink'])
    }
    expect(main(resolve({ themes: [{ ...brand, extends: 'ink' }] })).theme.chain).toEqual(['brand', 'ink', 'paper'])
  })
})

describe('основная тема', () => {
  it('по умолчанию — defaultTheme владельца, источник default', () => {
    const r = resolve()
    expect(r.themes.map(entry => entry.theme.id)).toEqual(['paper'])
    expect(main(r).theme.id).toBe('paper')
    expect(main(r).isDefault).toBe(true)
    expect(r.themeSource).toBe('default')
    expect(r.owner).toBe('@p/ds')
  })

  it('id из конфига и квалифицированная форма; цепочка тем для токенов компонентов', () => {
    expect(main(resolve({ themes: ['ink'] })).theme.chain).toEqual(['ink', 'paper'])
    expect(resolve({ themes: ['@p/ds:ink'] }).themeSource).toBe('provider')
  })

  it('неизвестная тема — unknown-theme со списком доступных; чужой провайдер в ключе — тоже', () => {
    expect(reasonOf(() => resolve({ themes: ['clay'] }))).toBe('unknown-theme')
    expect(reasonOf(() => resolve({ themes: ['@other/x:paper'] }))).toBe('unknown-theme')
    try {
      resolve({ themes: ['clay'] })
    }
    catch (error) {
      expect((error as ThemeResolutionError).available).toEqual(['paper', 'ink'])
    }
  })

  it('два владельца каталога — multiple-theme-owners', () => {
    expect(reasonOf(() => resolve({}, [owner('@a/one'), owner('@b/two')]))).toBe('multiple-theme-owners')
  })

  it('без владельца и без темы-объекта тем нет', () => {
    const r = resolve({}, [makeManifest('@p/plain', { X: {} })])
    expect(r.default).toBeUndefined()
    expect(r.themes).toEqual([])
  })

  it('каталог без defaultTheme: одна тема — она, несколько — unknown-theme', () => {
    expect(reasonOf(() => resolve({}, [owner('@p/ds', null)]))).toBe('unknown-theme')
  })

  it('тема-объект приложения: источник app, extends даёт цепочку каталога', () => {
    const brand: GranumAppTheme = { ...themeData('brand', { light: { 'p-bg': '#fafafa' } }), extends: 'ink' }
    const r = resolve({ themes: [brand] })
    expect(main(r).theme.providerId).toBe('(app)')
    expect(r.themeSource).toBe('app')
    expect(main(r).theme.chain).toEqual(['brand', 'ink', 'paper'])
  })

  it('данные темы каталога не переданы — theme-data-missing', () => {
    expect(reasonOf(() => resolveThemes([toProviderNode(owner())], {}, [], {}))).toBe('theme-data-missing')
  })
})

describe('темы сборки', () => {
  it('основная ровно одна: единственная — без пометки, из нескольких — помеченная', () => {
    const r = resolve({ themes: ['ink', { theme: 'paper', default: true }] })
    expect(r.themes.map(entry => `${entry.theme.id}${entry.isDefault ? '*' : ''}`)).toEqual(['ink', 'paper*'])
    expect(main(r).theme.id).toBe('paper')
    expect(additionalThemes(r).map(entry => entry.theme.id)).toEqual(['ink'])
    expect(r.themeSource).toBe('provider')
  })

  it('ни одной пометки, две пометки и пустой список — default-theme', () => {
    expect(reasonOf(() => resolve({ themes: ['paper', 'ink'] }))).toBe('default-theme')
    expect(reasonOf(() => resolve({ themes: [{ theme: 'paper', default: true }, { theme: 'ink', default: true }] }))).toBe('default-theme')
    expect(reasonOf(() => resolve({ themes: [] }))).toBe('default-theme')
  })

  it('одна тема дважды, в том числе тема-объект с id каталога, — duplicate-theme', () => {
    expect(reasonOf(() => resolve({ themes: [{ theme: 'paper', default: true }, '@p/ds:paper'] }))).toBe('duplicate-theme')
    expect(reasonOf(() => resolve({ themes: [{ theme: 'paper', default: true }, themeData('paper', { light: { a: '1' } })] }))).toBe('duplicate-theme')
  })

  it('план читает только темы из списка', () => {
    const plan = planThemes([toProviderNode(owner())], { themes: [{ theme: 'ink', default: true }, 'paper'] })
    expect(plan.themes.map(t => (t.pick.kind === 'catalog' ? `${t.pick.id}:${t.pick.data}` : ''))).toEqual(['ink:themes/ink.json', 'paper:themes/paper.json'])
    expect(plan.themes.map(t => t.isDefault)).toEqual([true, false])
  })

  it('режимы у каждой темы свои — по тому же правилу набора', () => {
    const r = resolve({ themes: [{ theme: 'ink', default: true, modes: ['dim'] }, { theme: 'paper', modes: ['light', 'dark'] }] })
    expect(r.themes.map(entry => `${entry.theme.id}:${entry.modes.map(m => m.value).join(',')}`)).toEqual(['ink:ink-dim', 'paper:paper-light,paper-dark'])
    // Без `modes` дополнительная тема — только свой режим по умолчанию, как и основная.
    expect(additionalThemes(resolve({ themes: [{ theme: 'ink', default: true }, 'paper'] }))[0]!.modes.map(m => m.name)).toEqual(['light'])
  })

  it('define и tokenOverrides — у своей темы: чужой режим в overrides — unknown-mode', () => {
    const r = resolve({ themes: [{ theme: 'paper', default: true }, { theme: 'ink', modes: { define: { ocean: { extends: 'dark' } } } }] })
    expect(main(r).definitions).toEqual([])
    expect(additionalThemes(r)[0]!.modes.map(m => m.value)).toEqual(['ink-light', 'ink-ocean'])
    expect(reasonOf(() => resolve({ themes: [{ theme: 'paper', default: true }, { theme: 'ink', modes: { tokenOverrides: { dim: { 'p-bg': 'red' } } } }] }))).toBe('unknown-mode')
  })

  it('пары всех тем сборки различны: шаблон без {theme} сталкивает одноимённые режимы', () => {
    expect(reasonOf(() => resolve({ themes: [{ theme: 'paper', default: true }, 'ink'], activation: { value: '{mode}' } }))).toBe('activation-collision')
  })
})

describe('режимы', () => {
  it('без modes — только режим по умолчанию темы, пара по шаблону', () => {
    const r = resolve({ themes: ['ink'] })
    expect(main(r).modes.map(m => `${m.name}=${m.value}`)).toEqual(['light=ink-light'])
    expect(main(r).modesSource).toBe('theme')
    expect(main(r).defaultMode).toBe('light')
    expect(r.activation).toEqual({ attribute: 'data-theme', value: '{theme}-{mode}' })
  })

  it('все режимы темы — перечислением; режим по умолчанию первым', () => {
    const r = resolve({ themes: [{ theme: 'ink', modes: ['dim', 'dark', 'light'] }] })
    expect(main(r).modes.map(m => `${m.name}=${m.value}`)).toEqual(['light=ink-light', 'dim=ink-dim', 'dark=ink-dark'])
  })

  it('names задаёт набор; режим по умолчанию всё равно первым', () => {
    const r = resolve({ themes: [{ theme: 'ink', modes: { names: ['dim', 'light'] } }] })
    expect(main(r).modes.map(m => m.name)).toEqual(['light', 'dim'])
    expect(main(r).modesSource).toBe('explicit')
  })

  it('неизвестный режим — unknown-mode', () => {
    expect(reasonOf(() => resolve({ themes: [{ theme: 'paper', modes: ['sepia'] }] }))).toBe('unknown-mode')
    expect(reasonOf(() => resolve({ themes: [{ theme: 'paper', modes: { tokenOverrides: { sepia: { 'p-bg': 'red' } } } }] }))).toBe('unknown-mode')
  })

  it('define поверх режима темы и другого define; база раньше наследника и в набор не обязана входить', () => {
    const r = resolve({ themes: [{ theme: 'paper', modes: { define: { deep: { extends: 'ocean' }, ocean: { extends: 'dark', title: 'Океан' } } } }] })
    // Без `names` в набор входят режим по умолчанию и режимы приложения;
    // `dark` — только база `ocean`: его значения взяты, блока у него нет.
    expect(main(r).modes.map(m => m.name)).toEqual(['light', 'ocean', 'deep'])
    expect(main(r).definitions.map(m => `${m.name}←${m.extends}`)).toEqual(['ocean←dark', 'deep←ocean'])
    const ocean = main(r).modes.find(m => m.name === 'ocean')!
    expect(ocean).toMatchObject({ origin: 'define', colorScheme: 'dark', title: 'Океан', value: 'paper-ocean' })
  })

  it('неизвестная база и цикл define — предупреждения с темой, наследуется режим по умолчанию', () => {
    const r = resolve({ themes: [{ theme: 'paper', modes: { define: { a: { extends: 'nope' }, b: { extends: 'c' }, c: { extends: 'b' } } } }] })
    expect(r.warnings).toContainEqual({ kind: 'mode-extends-unresolved', theme: 'paper', mode: 'a', base: 'nope' })
    expect(r.warnings.some(w => w.kind === 'mode-extends-cycle' && w.theme === 'paper')).toBe(true)
    expect(main(r).definitions.find(m => m.name === 'a')!.extends).toBe('light')
  })

  it('define с именем режима темы — та же пара: activation-collision', () => {
    expect(reasonOf(() => resolve({ themes: [{ theme: 'paper', modes: { define: { dark: { extends: 'light' } } } }] }))).toBe('activation-collision')
  })

  it('шаблон без {mode} — activation-collision', () => {
    expect(reasonOf(() => resolve({ activation: { value: '{theme}' } }))).toBe('activation-collision')
  })

  it('свой атрибут и шаблон', () => {
    const r = resolve({ themes: [{ theme: 'paper', modes: ['light', 'dark'] }], activation: { attribute: 'data-mode', value: '{mode}@{theme}' } })
    expect(main(r).modes.map(m => m.value)).toEqual(['light@paper', 'dark@paper'])
    expect(r.activation.attribute).toBe('data-mode')
  })
})

describe('токены компонентов чужих тем', () => {
  it('тема, которой нет ни в одном каталоге, — component-theme-unknown', () => {
    const ds = makeManifest('@p/ui', { Chart: { tokens: { themes: { unknown: { modes: { light: { x: '1' } } }, paper: { modes: {} } }, consumes: [], dynamic: [] } } })
    const providers = [owner(), ds].map(toProviderNode)
    const r = resolveThemes(providers, {}, providers[1]!.components, DATA)
    expect(r.warnings).toEqual([{ kind: 'component-theme-unknown', providerId: '@p/ui', component: 'Chart', theme: 'unknown' }])
  })

  it('промежуточный объект цепочки темы сборки — известная тема, а не чужая', () => {
    const brand: GranumAppTheme = { id: 'brand', title: 'Бренд', extends: 'paper' }
    const sale: GranumAppTheme = { id: 'sale', title: 'Распродажа', extends: brand }
    const ds = makeManifest('@p/ui', { Chart: { tokens: { themes: { brand: { modes: { light: { x: '1' } } } }, consumes: [], dynamic: [] } } })
    const providers = [owner(), ds].map(toProviderNode)
    const r = resolveThemes(providers, { themes: [sale] }, providers[1]!.components, DATA)
    expect(r.warnings.filter(w => w.kind === 'component-theme-unknown')).toEqual([])
  })
})

describe('тема-объект с extends дополняется из родителя (A-22, INV-THEME-14)', () => {
  /** Только отличия: форма неполна, как у исходника с `extends`. */
  const brand: GranumAppTheme = {
    id: 'brand',
    title: 'Бренд',
    root: { 'p-radius': '9px' },
    modes: { light: { tokens: { 'p-accent': '#ff0000' } } },
    extends: 'paper',
  }

  it('частичный объект над темой каталога получает остальные значения родителя', () => {
    const data = main(resolve({ themes: [brand] })).theme.data
    expect(data.root).toEqual({ 'p-radius': '9px', 'p-ring': PAPER.root['p-ring'] })
    expect(data.modes.light).toEqual({ colorScheme: 'light', tokens: { ...PAPER.modes.light!.tokens, 'p-accent': '#ff0000' } })
    expect(data.modes.dark).toEqual(PAPER.modes.dark)
    expect(data.title).toBe('Бренд')
  })

  it('родитель не обязан быть темой сборки: его данные читаются ради наследника', () => {
    const r = resolve({ themes: [brand] })
    expect(r.themes.map(entry => entry.theme.id)).toEqual(['brand'])
    expect(main(r).theme.chain).toEqual(['brand', 'paper'])
  })

  it('объект над объектом: цепочка раскрывается до темы каталога', () => {
    const sale: GranumAppTheme = { id: 'sale', title: 'Распродажа', modes: { dark: { tokens: { 'p-bg': '#220000' } } }, extends: brand }
    const theme = main(resolve({ themes: [sale] })).theme
    expect(theme.chain).toEqual(['sale', 'brand', 'paper'])
    expect(theme.data.root['p-radius']).toBe('9px')
    expect(theme.data.modes.dark!.tokens['p-bg']).toBe('#220000')
    expect(theme.data.modes.light!.tokens['p-accent']).toBe('#ff0000')
  })

  it('полные данные с extends и без него дают одно и то же', () => {
    const full: GranumAppTheme = { ...PAPER, id: 'twin', title: 'Двойник' }
    const withBase = main(resolve({ themes: [{ ...full, extends: 'paper' }] })).theme.data
    const without = main(resolve({ themes: [full] })).theme.data
    expect(withBase).toEqual(without)
  })

  it('данные после слияния проверяются целиком: нарушение — ThemeDataError с причиной', () => {
    const broken: GranumAppTheme = { ...brand, modes: { dim: { tokens: { 'p-bg': '#000' } } } }
    let error: unknown
    try {
      resolve({ themes: [broken] })
    }
    catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(ThemeDataError)
    expect((error as ThemeDataError).reason).toBe('invalid-theme-data')
  })

  it('объект без extends проверяется и в резолвере: его зовут и без проверки конфига', () => {
    let error: unknown
    try {
      resolve({ themes: [{ ...PAPER, id: 'raw', title: 'Сырая', root: { '--p-radius': '6px' } }] })
    }
    catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(ThemeDataError)
    expect((error as ThemeDataError).reason).toBe('token-key-prefix')
  })

  it('объекты, наследующие друг друга по кругу, — theme-extends-cycle, а не переполнение стека', () => {
    const a = { id: 'a', title: 'А', extends: 'paper' } as { id: string, title: string, extends: GranumAppTheme | string }
    const b: GranumAppTheme = { id: 'b', title: 'Б', extends: a as GranumAppTheme }
    a.extends = b
    expect(reasonOf(() => resolve({ themes: [b] }))).toBe('theme-extends-cycle')
  })

  it('отличия наследника по targets сливаются с родительскими по пакету (C-27)', () => {
    const withTargets = { ...DATA, '@p/ds': { ...DATA['@p/ds'], paper: { ...PAPER, targets: { '@p/ds': '^1.0.0' } } } }
    const heir: GranumAppTheme = { id: 'heir', title: 'Наследник', extends: 'paper', targets: { '@p/ui': '^2.0.0' } }
    const r = resolveThemes([owner()].map(toProviderNode), { themes: [heir] }, [], withTargets)
    expect(main(r).theme.data.targets).toEqual({ '@p/ds': '^1.0.0', '@p/ui': '^2.0.0' })
  })
})
