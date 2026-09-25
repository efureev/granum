import { describe, expect, it } from 'vitest'
import {
  CircularDependencyError,
  ComponentNotFoundError,
  DuplicateComponentNameError,
  DuplicateProviderIdError,
  InvalidComponentKeyError,
  ProviderNotRegisteredError,
} from '../core/errors'
import { toProviderNode } from '../core/providerNode'
import { buildRegistry, resolveComponentTarget } from '../core/registry'
import { collectClasses, collectComponentCss, collectDependencyClosure, collectSafelist, resolveSelection } from '../core/resolveSelection'
import { makeManifest, makeProvider } from './helpers'

const P_DS = makeProvider('ds', {
  components: [
    { name: 'DsButton', safelist: ['ds-button'], cssFiles: ['components/DsButton/styles.css'] },
    { name: 'DsInput', safelist: ['ds-input'], cssFiles: ['components/DsInput/styles.css'] },
    { name: 'DsFormField', safelist: ['ds-form-field'], dependencies: ['DsInput'] },
  ],
})

const P_XG = makeProvider('xg', {
  components: [
    { name: 'XgFormActions', safelist: ['xg-form-actions'], dependencies: ['ds:DsButton'] },
    {
      name: 'XgQuickForm',
      safelist: ['xg-quick-form'],
      dependencies: ['XgFormActions', 'ds:DsInput', { provider: 'ds', components: ['DsFormField'] }],
    },
  ],
})

function reg(...inputs: Parameters<typeof toProviderNode>[0][]): ReturnType<typeof buildRegistry> {
  return buildRegistry(inputs.map(toProviderNode))
}

describe('buildRegistry', () => {
  it('ругается на дубли провайдеров и имён компонентов', () => {
    expect(() => reg(P_DS, P_DS)).toThrow(DuplicateProviderIdError)
    const dup = { ...makeProvider('dup'), components: [{ name: 'Same' }, { name: 'Same' }] }
    expect(() => reg(dup)).toThrow(DuplicateComponentNameError)
  })

  it('resolveComponentTarget: короткая форма только при однозначности', () => {
    const r = reg(P_DS, P_XG)
    expect(resolveComponentTarget('ds:DsButton', r)).toEqual({ key: 'ds:DsButton' })
    expect(resolveComponentTarget('DsButton', r)).toEqual({ key: 'ds:DsButton' })
    const both = reg(P_DS, makeProvider('other', { components: [{ name: 'DsButton' }] }))
    expect(resolveComponentTarget('DsButton', both)).toEqual({ ambiguous: ['ds:DsButton', 'other:DsButton'] })
  })
})

describe('resolveSelection', () => {
  it('все компоненты всех провайдеров при selection=undefined и "all"', () => {
    for (const sel of [undefined, 'all' as const]) {
      const r = resolveSelection(reg(P_DS, P_XG), sel)
      expect([...r.order].sort()).toEqual(['ds:DsButton', 'ds:DsFormField', 'ds:DsInput', 'xg:XgFormActions', 'xg:XgQuickForm'])
    }
  })

  it('транзитивные cross-provider deps подтягиваются; post-order (INV-SEL-2)', () => {
    const r = resolveSelection(reg(P_DS, P_XG), ['xg:XgQuickForm'])
    expect(r.order).toEqual(['ds:DsButton', 'xg:XgFormActions', 'ds:DsInput', 'ds:DsFormField', 'xg:XgQuickForm'])
    expect(r.providers.map(p => p.id)).toEqual(['ds', 'xg'])
  })

  it('объектная форма селекции и names=all', () => {
    expect(resolveSelection(reg(P_DS, P_XG), [{ provider: 'xg', names: ['XgFormActions'] }]).order)
      .toEqual(['ds:DsButton', 'xg:XgFormActions'])
    expect([...resolveSelection(reg(P_DS), [{ provider: 'ds', names: 'all' }]).order].sort())
      .toEqual(['ds:DsButton', 'ds:DsFormField', 'ds:DsInput'])
  })

  it('разделитель — ПОСЛЕДНЕЕ двоеточие (INV-SEL-1)', () => {
    const scoped = makeProvider('@scope/pkg:sub', { components: [{ name: 'Btn' }] })
    expect(resolveSelection(reg(scoped), ['@scope/pkg:sub:Btn']).order).toEqual(['@scope/pkg:sub:Btn'])
  })

  it('короткая форма и пустые стороны ключа в селекции — InvalidComponentKeyError (INV-SEL-4)', () => {
    for (const bad of ['DsButton', ':X', 'X:']) {
      try {
        resolveSelection(reg(P_DS), [bad])
        throw new Error('should have thrown')
      }
      catch (e) {
        expect(e).toBeInstanceOf(InvalidComponentKeyError)
        expect((e as InvalidComponentKeyError).key).toBe(bad)
      }
    }
  })

  it('незарегистрированный провайдер и ненайденный компонент — типизированные ошибки с контекстом', () => {
    expect(() => resolveSelection(reg(P_XG), ['xg:XgQuickForm'])).toThrow(ProviderNotRegisteredError)
    expect(() => resolveSelection(reg(P_DS), [{ provider: 'nope', names: 'all' }])).toThrow(ProviderNotRegisteredError)
    try {
      resolveSelection(reg(P_DS), ['ds:Nope'])
      throw new Error('should have thrown')
    }
    catch (e) {
      expect(e).toBeInstanceOf(ComponentNotFoundError)
      expect((e as ComponentNotFoundError).available).toEqual(['DsButton', 'DsInput', 'DsFormField'])
    }
  })

  it('детектит циклы с цепочкой (INV-SEL-3)', () => {
    const cyclic = makeProvider('c', { components: [{ name: 'A', dependencies: ['B'] }, { name: 'B', dependencies: ['A'] }] })
    try {
      resolveSelection(reg(cyclic), ['c:A'])
      throw new Error('should have thrown')
    }
    catch (e) {
      expect(e).toBeInstanceOf(CircularDependencyError)
      expect((e as CircularDependencyError).chain).toEqual(['c:A', 'c:B', 'c:A'])
    }
  })

  it('safelist и классы — отсортированные объединения (INV-DET-3)', () => {
    const r = resolveSelection(reg(P_DS, P_XG), ['xg:XgQuickForm'])
    expect(collectSafelist(r.entries)).toEqual(['ds-button', 'ds-form-field', 'ds-input', 'xg-form-actions', 'xg-quick-form'])
    expect(collectClasses(r.entries)).toEqual([])
  })

  it('css компонентов дедуплицируется по (провайдер, путь) и идёт в порядке селекции', () => {
    const r = resolveSelection(reg(P_DS), ['ds:DsFormField', 'ds:DsButton', { provider: 'ds', names: ['DsButton'] }])
    expect(collectComponentCss(r.entries)).toEqual([
      { providerId: 'ds', componentName: 'DsInput', path: 'components/DsInput/styles.css' },
      { providerId: 'ds', componentName: 'DsButton', path: 'components/DsButton/styles.css' },
    ])
  })

  it('манифестная форма: классы, css и зависимости берутся из манифеста', () => {
    const m = makeManifest('@x/h', {
      XhCard: { classes: ['p-4', 'flex'], css: ['components/XhCard/styles.css'] },
      XhPanel: { classes: ['gap-2', 'flex'], dependencies: ['XhCard'], safelist: ['p-2'] },
    })
    const r = resolveSelection(reg(m), ['@x/h:XhPanel'])
    expect(r.order).toEqual(['@x/h:XhCard', '@x/h:XhPanel'])
    expect(collectClasses(r.entries)).toEqual(['flex', 'gap-2', 'p-4'])
    expect(collectSafelist(r.entries)).toEqual(['p-2'])
    expect(collectComponentCss(r.entries).map(c => c.path)).toEqual(['components/XhCard/styles.css'])
  })

  it('collectDependencyClosure не требует зарегистрированности ссылок', () => {
    const closure = collectDependencyClosure(reg(P_XG), 'xg:XgQuickForm')
    expect([...closure].sort()).toEqual(['ds:DsButton', 'ds:DsFormField', 'ds:DsInput', 'xg:XgFormActions', 'xg:XgQuickForm'])
  })
})
