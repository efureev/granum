import type { GranumLoadedManifest } from '../contract'
import type { GranumAppTheme, ResolveThemesInput } from '../core/resolveThemes'
import { describe, expect, it } from 'vitest'
import { ThemeResolutionError } from '../core/errors'
import { toProviderNode } from '../core/providerNode'
import { planThemes, resolveThemes } from '../core/resolveThemes'
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

function reasonOf(run: () => unknown): string | undefined {
  try {
    run()
  }
  catch (error) {
    return error instanceof ThemeResolutionError ? error.reason : `not a ThemeResolutionError: ${(error as Error).message}`
  }
  return undefined
}

describe('активная тема (A-22, A-23)', () => {
  it('по умолчанию — defaultTheme владельца, источник default', () => {
    const r = resolve()
    expect(r.theme?.id).toBe('paper')
    expect(r.themeSource).toBe('default')
    expect(r.owner).toBe('@p/ds')
  })

  it('id из конфига и квалифицированная форма; цепочка тем для токенов компонентов', () => {
    expect(resolve({ theme: 'ink' }).theme?.chain).toEqual(['ink', 'paper'])
    expect(resolve({ theme: '@p/ds:ink' }).themeSource).toBe('provider')
  })

  it('неизвестная тема — unknown-theme со списком доступных; чужой провайдер в ключе — тоже', () => {
    expect(reasonOf(() => resolve({ theme: 'clay' }))).toBe('unknown-theme')
    expect(reasonOf(() => resolve({ theme: '@other/x:paper' }))).toBe('unknown-theme')
    try {
      resolve({ theme: 'clay' })
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
    expect(r.theme).toBeUndefined()
    expect(r.modes).toEqual([])
  })

  it('каталог без defaultTheme: одна тема — она, несколько — unknown-theme', () => {
    expect(reasonOf(() => resolve({}, [owner('@p/ds', null)]))).toBe('unknown-theme')
  })

  it('тема-объект приложения: источник app, extends даёт цепочку каталога', () => {
    const brand: GranumAppTheme = { ...themeData('brand', { light: { 'p-bg': '#fafafa' } }), extends: 'ink' }
    const r = resolve({ theme: brand })
    expect(r.theme?.providerId).toBe('(app)')
    expect(r.themeSource).toBe('app')
    expect(r.theme?.chain).toEqual(['brand', 'ink', 'paper'])
  })

  it('данные темы каталога не переданы — theme-data-missing', () => {
    expect(reasonOf(() => resolveThemes([toProviderNode(owner())], {}, [], {}))).toBe('theme-data-missing')
  })

  it('план читает только активную тему и превью (T-6)', () => {
    const plan = planThemes([toProviderNode(owner())], { theme: 'ink', previews: ['paper'] })
    expect(plan.active).toEqual({ kind: 'catalog', providerId: '@p/ds', id: 'ink', data: 'themes/ink.json' })
    expect(plan.previews.map(p => p.kind === 'catalog' ? p.id : '')).toEqual(['paper'])
  })
})

describe('режимы (A-25, A-26, A-28)', () => {
  it('без modes.names — только режим по умолчанию темы, пара по шаблону', () => {
    const r = resolve({ theme: 'ink' })
    expect(r.modes.map(m => `${m.name}=${m.value}`)).toEqual(['light=ink-light'])
    expect(r.modesSource).toBe('theme')
    expect(r.defaultMode).toBe('light')
    expect(r.activation).toEqual({ attribute: 'data-theme', value: '{theme}-{mode}' })
  })

  it('все режимы темы — перечислением; режим по умолчанию первым', () => {
    const r = resolve({ theme: 'ink', modes: { names: ['dim', 'dark', 'light'] } })
    expect(r.modes.map(m => `${m.name}=${m.value}`)).toEqual(['light=ink-light', 'dim=ink-dim', 'dark=ink-dark'])
  })

  it('modes.names задаёт набор; режим по умолчанию всё равно первым', () => {
    const r = resolve({ theme: 'ink', modes: { names: ['dim', 'light'] } })
    expect(r.modes.map(m => m.name)).toEqual(['light', 'dim'])
    expect(r.modesSource).toBe('explicit')
  })

  it('неизвестный режим — unknown-mode', () => {
    expect(reasonOf(() => resolve({ modes: { names: ['sepia'] } }))).toBe('unknown-mode')
    expect(reasonOf(() => resolve({ modes: { tokenOverrides: { sepia: { 'p-bg': 'red' } } } }))).toBe('unknown-mode')
  })

  it('define поверх режима темы и другого define; база раньше наследника и в набор не обязана входить', () => {
    const r = resolve({ modes: { define: { deep: { extends: 'ocean' }, ocean: { extends: 'dark', title: 'Океан' } } } })
    // Без `modes.names` в набор входят режим по умолчанию и режимы приложения;
    // `dark` — только база `ocean`: его значения взяты, блока у него нет.
    expect(r.modes.map(m => m.name)).toEqual(['light', 'ocean', 'deep'])
    expect(r.definitions.map(m => `${m.name}←${m.extends}`)).toEqual(['ocean←dark', 'deep←ocean'])
    const ocean = r.modes.find(m => m.name === 'ocean')!
    expect(ocean).toMatchObject({ origin: 'define', colorScheme: 'dark', title: 'Океан', value: 'paper-ocean' })
  })

  it('неизвестная база и цикл define — предупреждения, наследуется режим по умолчанию', () => {
    const r = resolve({ modes: { define: { a: { extends: 'nope' }, b: { extends: 'c' }, c: { extends: 'b' } } } })
    expect(r.warnings).toContainEqual({ kind: 'mode-extends-unresolved', mode: 'a', base: 'nope' })
    expect(r.warnings.some(w => w.kind === 'mode-extends-cycle')).toBe(true)
    expect(r.definitions.find(m => m.name === 'a')!.extends).toBe('light')
  })

  it('define с именем режима темы — та же пара: activation-collision', () => {
    expect(reasonOf(() => resolve({ modes: { define: { dark: { extends: 'light' } } } }))).toBe('activation-collision')
  })

  it('шаблон без {mode} и совпавшие пары — activation-collision', () => {
    expect(reasonOf(() => resolve({ modes: { activation: { value: '{theme}' } } }))).toBe('activation-collision')
    expect(reasonOf(() => resolve({ previews: ['paper'], modes: { activation: { value: '{mode}' } } }))).toBe('activation-collision')
  })

  it('свой атрибут и шаблон', () => {
    const r = resolve({ modes: { names: ['light', 'dark'], activation: { attribute: 'data-mode', value: '{mode}@{theme}' } } })
    expect(r.modes.map(m => m.value)).toEqual(['light@paper', 'dark@paper'])
    expect(r.activation.attribute).toBe('data-mode')
  })
})

describe('превью (A-32)', () => {
  it('режимы превью — все режимы её данных, пары своей темы', () => {
    const r = resolve({ theme: 'ink', previews: ['paper'] })
    expect(r.previews.map(p => `${p.theme.id}:${p.modes.map(m => m.value).join(',')}`)).toEqual(['paper:paper-light,paper-dark'])
  })
})

describe('токены компонентов чужих тем (C-36)', () => {
  it('тема, которой нет ни в одном каталоге, — component-theme-unknown', () => {
    const ds = makeManifest('@p/ui', { Chart: { tokens: { themes: { unknown: { modes: { light: { x: '1' } } }, paper: { modes: {} } }, consumes: [], dynamic: [] } } })
    const providers = [owner(), ds].map(toProviderNode)
    const r = resolveThemes(providers, {}, providers[1]!.components, DATA)
    expect(r.warnings).toEqual([{ kind: 'component-theme-unknown', providerId: '@p/ui', component: 'Chart', theme: 'unknown' }])
  })
})
