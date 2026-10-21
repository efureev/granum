import type { GranumLoadedManifest, GranumThemeData } from '../contract'
import type { ResolvedThemeWarning } from '../core/resolveThemes'
import { describe, expect, it } from 'vitest'
import { toProviderNode } from '../core/providerNode'
import { resolveThemes } from '../core/resolveThemes'
import { component, makeManifest, makeProvider, themeData } from './helpers'

const UI = '@acme/ui'
const OWNER = '@acme/tokens'

/** Владелец каталога: одна тема `stone`, данные приходят резолверу отдельно. */
const owner = makeManifest(OWNER, {}, {
  theme: { catalog: { stone: { title: 'Камень', data: 'themes/stone.json', modes: ['light'], defaultMode: 'light' } }, declares: [] },
})

/** Пакет компонентов: что кнопка требует извне, что читает только хуком, что ставит сама. */
const ui = makeManifest(UI, {
  Button: {
    tokens: {
      consumes: ['--btn-bg', '--btn-radius', '--btn-shadow', '--btn-gap', '--gr-accent'],
      requires: ['--btn-bg', '--btn-radius', '--gr-accent'],
      optional: ['--btn-shadow'],
      hooks: ['--btn-shadow'],
      dynamic: [],
    },
  },
  Card: { tokens: { consumes: ['--card-bg'], requires: ['--card-bg'], dynamic: [] } },
}, { version: '1.4.0' })

const REGISTRY = { 'gr-accent': 'mode' } as const

function stone(components: GranumThemeData['components'], patch: Partial<GranumThemeData> = {}): GranumThemeData {
  return themeData('stone', { light: { 'gr-accent': '#2563eb' } }, {
    targets: { [UI]: '^1.0.0', '@acme/absent': '^1.0.0' },
    ...(components !== undefined ? { components } : {}),
    ...patch,
  })
}

function warningsFor(data: GranumThemeData, selected: readonly string[] = [], providers: GranumLoadedManifest[] = [owner, ui]): ResolvedThemeWarning[] {
  const nodes = providers.map(toProviderNode)
  const components = nodes.flatMap(node => node.components).filter(c => selected.includes(c.name))
  const resolved = resolveThemes(nodes, { themes: ['stone'] }, components, { [OWNER]: { stone: data } }, REGISTRY)
  return resolved.warnings.filter(w => w.kind === 'theme-component-unknown' || w.kind === 'theme-token-foreign')
}

describe('принадлежность значений темы (A-37, INV-THEME-11)', () => {
  it('значения, которые компоненты требуют извне, находок не дают', () => {
    const data = stone({ [UI]: { Button: { root: { 'btn-radius': '6px' }, modes: { light: { 'btn-bg': '#ffffff' } } }, Card: { modes: { light: { 'card-bg': '#fafafa' } } } } })
    expect(warningsFor(data, ['Button', 'Card'])).toEqual([])
  })

  it('токен раздела, которого компонент не требует извне, — находка: хук, свой, глобальный, опечатка', () => {
    const data = stone({
      [UI]: {
        Button: {
          root: { 'btn-shadow': 'none', 'btn-gap': '4px', 'btn-radus': '6px' },
          modes: { light: { 'gr-accent-2': '#000' } },
        },
      },
    })
    // Глобальный токен реестра, которого компонент требует, тоже не место для раздела.
    const global = stone({ [UI]: { Button: { modes: { light: { 'btn-bg': '#fff' } } } } }, { modes: { light: { colorScheme: 'light', tokens: {} } } })
    const globalInSection = { ...global, components: { [UI]: { Button: { modes: { light: { 'gr-accent': '#123456' } } } } } }
    expect(warningsFor(data).map(w => (w.kind === 'theme-token-foreign' ? w.token : w.kind))).toEqual(['btn-gap', 'btn-radus', 'btn-shadow', 'gr-accent-2'])
    expect(warningsFor(globalInSection)).toEqual([
      { kind: 'theme-token-foreign', theme: 'stone', providerId: UI, component: 'Button', token: 'gr-accent', place: 'section' },
    ])
  })

  it('компонента нет у провайдера графа — theme-component-unknown; пакета нет в графе — раздел пропускается', () => {
    const data = stone({
      [UI]: { Panel: { root: { 'panel-bg': '#fff' } } },
      '@acme/absent': { Chart: { root: { 'chart-1': '#000' } } },
    })
    expect(warningsFor(data)).toEqual([{ kind: 'theme-component-unknown', theme: 'stone', providerId: UI, component: 'Panel' }])
  })

  it('хук компонента селекции в root/modes темы — находка; у невыбранного компонента — нет', () => {
    const data = stone(undefined, { root: { 'btn-shadow': 'none' } })
    expect(warningsFor(data, ['Button'])).toEqual([
      { kind: 'theme-token-foreign', theme: 'stone', providerId: UI, component: 'Button', token: 'btn-shadow', place: 'hook' },
    ])
    expect(warningsFor(data, ['Card'])).toEqual([])
  })

  it('хук в разделе — одна находка, хотя слиянием он есть и в режимах темы', () => {
    const data = stone({ [UI]: { Button: { modes: { light: { 'btn-shadow': 'none' } } } } })
    expect(warningsFor(data, ['Button'])).toEqual([
      { kind: 'theme-token-foreign', theme: 'stone', providerId: UI, component: 'Button', token: 'btn-shadow', place: 'section' },
    ])
  })

  it('токен, который компонент требует извне, — его токен темы, даже если он подходит под шаблон хука', () => {
    const patterned = makeManifest(UI, {
      Button: { tokens: { consumes: ['--btn-bg', '--btn-shadow'], requires: ['--btn-bg'], optional: ['--btn-shadow'], hooks: ['--btn-*'], dynamic: [] } },
    }, { version: '1.4.0' })
    const data = stone(undefined, { root: { 'btn-bg': '#fff', 'btn-shadow': 'none' } })
    expect(warningsFor(data, ['Button'], [owner, patterned])).toEqual([
      { kind: 'theme-token-foreign', theme: 'stone', providerId: UI, component: 'Button', token: 'btn-shadow', place: 'hook' },
    ])
  })

  it('объектный провайдер без посчитанных требований не судится', () => {
    const objectUi = makeProvider(UI, { components: [component('Button')] })
    const data = stone({ [UI]: { Button: { root: { anything: '1' } } } })
    expect(warningsFor(data, [], [owner, objectUi as never])).toEqual([])
  })
})
