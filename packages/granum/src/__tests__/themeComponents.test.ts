import type { GranumThemeData } from '../contract'
import { describe, expect, it } from 'vitest'
import { checkThemeData, flattenThemeComponents, mergeThemePatch, unflattenThemeComponents } from '../core/themeData'
import { PAPER } from './helpers'

const DS = '@acme/ui'

/** «Бумага» со значениями кнопки и карточки пакета `@acme/ui`. */
function valued(patch: Partial<GranumThemeData> = {}): GranumThemeData {
  return {
    ...PAPER,
    version: '1.2.0',
    targets: { [DS]: '^1.0.0' },
    components: {
      [DS]: {
        Button: { root: { 'btn-radius': '6px' }, modes: { light: { 'btn-bg': '#ffffff' }, dark: { 'btn-bg': '#000000' } } },
        Card: { modes: { light: { 'card-bg': '#fafafa' } } },
      },
    },
    ...patch,
  }
}

function reasonOf(data: unknown, options?: Parameters<typeof checkThemeData>[1]): string | undefined {
  return checkThemeData(data, options)?.reason
}

describe('раздел components данных темы (C-40)', () => {
  it('полная тема со значениями компонентов проходит проверку', () => {
    expect(checkThemeData(valued())).toBeUndefined()
  })

  it('режим раздела обязан быть режимом темы', () => {
    const data = valued({ components: { [DS]: { Button: { modes: { dim: { 'btn-bg': '#111111' } } } } } })
    expect(checkThemeData(data)).toMatchObject({ reason: 'invalid-theme-component-mode', path: `components.${DS}.Button.modes.dim` })
  })

  it('у значения одно место: два раздела, раздел и тема, root и режим одного раздела — коллизия', () => {
    const twoSections = valued({ components: { [DS]: { Button: { root: { shared: '1px' } }, Card: { root: { shared: '2px' } } } } })
    expect(reasonOf(twoSections)).toBe('theme-token-collision')
    const sectionAndTheme = valued({ components: { [DS]: { Button: { modes: { light: { 'p-accent': '#ff0000' } } } } } })
    expect(checkThemeData(sectionAndTheme)).toMatchObject({ reason: 'theme-token-collision', path: `components.${DS}.Button.modes` })
    const rootAndMode = valued({ components: { [DS]: { Button: { root: { 'btn-bg': '#fff' }, modes: { light: { 'btn-bg': '#eee' } } } } } })
    expect(reasonOf(rootAndMode)).toBe('theme-token-collision')
    // Один токен в разных режимах одного раздела — одно место, а не коллизия.
    expect(reasonOf(valued())).toBeUndefined()
  })

  it('данные dist несут значения раздела ещё и слитыми: копия на том же месте с тем же значением — след слияния (C-44)', () => {
    const flat = flattenThemeComponents(valued())
    expect(reasonOf(flat)).toBe('theme-token-collision')
    expect(reasonOf(flat, { flattened: true })).toBeUndefined()
    const { targets: _targets, ...untargeted } = flat
    expect(reasonOf(untargeted, { flattened: true })).toBe('theme-components-untargeted')
  })

  it('копия с другим значением или на другом месте — коллизия и в данных dist: значение автора не теряется молча', () => {
    const flat = flattenThemeComponents(valued())
    const otherValue = { ...flat, modes: { ...flat.modes, light: { ...flat.modes.light!, tokens: { ...flat.modes.light!.tokens, 'btn-bg': '#eeeeee' } } } }
    expect(checkThemeData(otherValue, { flattened: true })).toMatchObject({ reason: 'theme-token-collision' })
    const otherPlace = { ...flat, root: { ...flat.root, 'card-bg': '#fafafa' } }
    expect(reasonOf(otherPlace, { flattened: true })).toBe('theme-token-collision')
    // Разведение снимает только точные копии.
    expect(unflattenThemeComponents(otherValue).modes.light!.tokens['btn-bg']).toBe('#eeeeee')
  })

  it('имя пакета и компонента раздела — по форме: оно становится путём папки', () => {
    for (const provider of ['../x', '@acme/../x', 'Acme UI', '@acme', ''])
      expect(reasonOf(valued({ components: { [provider]: { Button: { root: { x: '1' } } } } })), provider).toBe('invalid-theme-data')
    for (const name of ['../Button', 'Button.v2', 'a/b', ''])
      expect(reasonOf(valued({ components: { [DS]: { [name]: { root: { x: '1' } } } } })), name).toBe('invalid-theme-data')
    expect(reasonOf(valued({ targets: { 'plain-ds': '*' }, components: { 'plain-ds': { Card_2: { root: { x: '1' } } } } }))).toBeUndefined()
  })

  it('пакет раздела обязан быть в targets (C-41)', () => {
    expect(checkThemeData(valued({ targets: { '@acme/other': '^1.0.0' } }))).toMatchObject({ reason: 'theme-components-untargeted', path: `components.${DS}` })
    const { targets: _targets, ...noTargets } = valued()
    expect(reasonOf(noTargets)).toBe('theme-components-untargeted')
    // Тема без значений компонентов targets может не называть вовсе.
    expect(reasonOf(PAPER)).toBeUndefined()
  })

  it('форма раздела: объект пакетов, компонентов, { root?, modes? } и токенов без --', () => {
    expect(reasonOf(valued({ components: [] as never }))).toBe('invalid-theme-data')
    expect(reasonOf(valued({ components: { [DS]: { Button: { tokens: {} } as never } } }))).toBe('invalid-theme-data')
    expect(reasonOf(valued({ components: { [DS]: { Button: { root: { '--btn-radius': '6px' } } } } }))).toBe('token-key-prefix')
    expect(reasonOf(valued({ components: { [DS]: { Button: { root: { 'btn-radius': 6 as never } } } } }))).toBe('invalid-theme-data')
  })

  it('версия и диапазоны — по грамматике', () => {
    expect(checkThemeData(valued({ version: '1.2' }))).toMatchObject({ reason: 'invalid-theme-version', path: 'version' })
    expect(checkThemeData(valued({ version: '1.2.3+build' }))).toMatchObject({ reason: 'invalid-theme-version' })
    expect(checkThemeData(valued({ targets: { [DS]: 'latest' } }))).toMatchObject({ reason: 'invalid-theme-targets', path: `targets.${DS}` })
    expect(reasonOf(valued({ version: '2.0.0-rc.1', targets: { [DS]: '>=1.2.0 <3.0.0 || ^4' } }))).toBeUndefined()
  })

  it('исходник с extends: форма проверяется, режимы раздела и targets — после слияния', () => {
    const patch = { components: { [DS]: { Button: { modes: { dim: { 'btn-bg': '#111' } } } } } }
    expect(reasonOf(patch, { partial: true })).toBeUndefined()
    expect(reasonOf({ components: { [DS]: { Button: { root: { '--x': '1' } } } } }, { partial: true })).toBe('token-key-prefix')
  })
})

describe('наследование темы с разделом components (C-27, INV-THEME-4)', () => {
  it('раздел сливается по пакету, компоненту, root или режиму и токену', () => {
    const merged = mergeThemePatch(valued(), {
      components: {
        [DS]: { Button: { modes: { dark: { 'btn-fg': '#ffffff' } } }, Badge: { root: { 'badge-radius': '999px' } } },
        '@acme/charts': { Chart: { modes: { light: { 'chart-1': '#123456' } } } },
      },
      targets: { [DS]: '^1.0.0', '@acme/charts': '^2.0.0' },
    }, { id: 'ink', title: 'Чернила' })
    expect(merged.components).toEqual({
      [DS]: {
        Button: { root: { 'btn-radius': '6px' }, modes: { light: { 'btn-bg': '#ffffff' }, dark: { 'btn-bg': '#000000', 'btn-fg': '#ffffff' } } },
        Card: { modes: { light: { 'card-bg': '#fafafa' } } },
        Badge: { root: { 'badge-radius': '999px' } },
      },
      '@acme/charts': { Chart: { modes: { light: { 'chart-1': '#123456' } } } },
    })
    expect(checkThemeData(merged)).toBeUndefined()
  })

  it('targets сливаются по пакету, version — только своя', () => {
    const inherited = mergeThemePatch(valued(), {}, { id: 'ink', title: 'Чернила' })
    expect(inherited.targets).toEqual({ [DS]: '^1.0.0' })
    expect(inherited.version).toBeUndefined()
    const own = mergeThemePatch(valued(), { version: '0.1.0', targets: { [DS]: '^2.0.0' } }, { id: 'ink', title: 'Чернила' })
    expect(own.version).toBe('0.1.0')
    expect(own.targets).toEqual({ [DS]: '^2.0.0' })
    // Наследник назвал новый пакет — унаследованный раздел цели не теряет.
    const extra = mergeThemePatch(valued(), { targets: { '@acme/charts': '^2.0.0' }, components: { '@acme/charts': { Chart: { root: { 'chart-1': '#123456' } } } } }, { id: 'ink', title: 'Чернила' })
    expect(extra.targets).toEqual({ [DS]: '^1.0.0', '@acme/charts': '^2.0.0' })
    expect(checkThemeData(extra)).toBeUndefined()
    expect(mergeThemePatch(PAPER, {}, { id: 'ink', title: 'Чернила' }).targets).toBeUndefined()
  })
})

describe('слияние раздела в root/modes и обратно (T-7, C-44)', () => {
  it('значения раздела видны токенами темы, раздел остаётся индексом', () => {
    const flat = flattenThemeComponents(valued())
    expect(flat.root['btn-radius']).toBe('6px')
    expect(flat.modes.light!.tokens['btn-bg']).toBe('#ffffff')
    expect(flat.modes.dark!.tokens['btn-bg']).toBe('#000000')
    expect(flat.modes.light!.tokens['card-bg']).toBe('#fafafa')
    expect(flat.modes.light!.tokens['p-accent']).toBe(PAPER.modes.light!.tokens['p-accent'])
    expect(flat.components).toEqual(valued().components)
  })

  it('разведение возвращает чистые данные; слияние идемпотентно', () => {
    const pure = valued()
    const flat = flattenThemeComponents(pure)
    expect(unflattenThemeComponents(flat)).toEqual(pure)
    expect(flattenThemeComponents(flat)).toEqual(flat)
    expect(flattenThemeComponents(PAPER)).toBe(PAPER)
    expect(unflattenThemeComponents(PAPER)).toBe(PAPER)
  })
})
