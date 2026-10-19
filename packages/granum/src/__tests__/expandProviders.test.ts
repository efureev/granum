import type { GranumProvider } from '../contract'
import { describe, expect, it } from 'vitest'
import {
  CircularProviderDependencyError,
  DuplicateProviderIdError,
  InvalidProviderError,
  UnresolvedProviderDependencyError,
  UnsupportedContractVersionError,
} from '../core/errors'
import { expandProviders } from '../core/expandProviders'
import { makeManifest, makeProvider } from './helpers'

function mk(id: string, dependencies: readonly (GranumProvider | string)[] = []): GranumProvider {
  return makeProvider(id, { dependencies })
}

describe('expandProviders', () => {
  it('бросает UnsupportedContractVersionError при чужой версии контракта', () => {
    const bad = { id: 'future', contractVersion: 3, components: [] } as unknown as GranumProvider
    expect(() => expandProviders([bad])).toThrow(UnsupportedContractVersionError)
    // Контракт 1 — только без тем: так читается спутник, которому темы не нужны.
    const legacy = { id: 'legacy', contractVersion: 1, components: [{ name: 'X', themesDir: 'components/X/themes' }] } as unknown as GranumProvider
    expect(() => expandProviders([legacy])).toThrow(UnsupportedContractVersionError)
    expect(expandProviders([{ id: 'plain', contractVersion: 1, components: [] } as unknown as GranumProvider])).toHaveLength(1)
  })

  it('проверяет рукописный объект так же, как defineGranumProvider', () => {
    const bad = { id: ' ', contractVersion: 1, components: [] } as GranumProvider
    expect(() => expandProviders([bad])).toThrow(InvalidProviderError)
  })

  it('возвращает roots без изменений, если нет dependencies', () => {
    expect(expandProviders([mk('a'), mk('b')]).map(p => p.id)).toEqual(['a', 'b'])
  })

  it('разворачивает цепочку A -> B (B раньше A)', () => {
    const b = mk('b')
    expect(expandProviders([mk('a', [b])]).map(p => p.id)).toEqual(['b', 'a'])
  })

  it('дедуплицирует ромб на одном инстансе: A -> B, A -> C, C -> B', () => {
    const b = mk('b')
    const c = mk('c', [b])
    expect(expandProviders([mk('a', [b, c])]).map(p => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('цикл A -> B -> A — CircularProviderDependencyError с цепочкой', () => {
    const a = mk('a')
    const b = mk('b', [a])
    ;(a as unknown as { dependencies: unknown[] }).dependencies = [b]
    expect(() => expandProviders([a])).toThrow(CircularProviderDependencyError)
    expect(() => expandProviders([a])).toThrow(/a -> b -> a/)
  })

  it('два разных инстанса с одним id — DuplicateProviderIdError', () => {
    expect(() => expandProviders([mk('a'), mk('a')])).toThrow(DuplicateProviderIdError)
  })

  it('строковая зависимость — мягкая: резолвится по roots, иначе ошибка', () => {
    expect(expandProviders([mk('a', ['b']), mk('b')]).map(p => p.id).sort()).toEqual(['a', 'b'])
    expect(() => expandProviders([mk('a', ['b'])])).toThrow(UnresolvedProviderDependencyError)
    expect(() => expandProviders([mk('a', ['b'])])).toThrow(/'b'/)
  })

  it('топосортирует несколько корней: roots=[a, c], a->b, c->b', () => {
    const b = mk('b')
    expect(expandProviders([mk('a', [b]), mk('c', [b])]).map(p => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('манифесты: зависимости — id, обязаны присутствовать; один и тот же манифест дважды — не конфликт', () => {
    const heavy = makeManifest('@x/heavy', {}, { dependencies: ['@x/simple'] })
    const simple = makeManifest('@x/simple')
    // Строковая зависимость задаёт порядок так же, как объектная: донор раньше.
    expect(expandProviders([heavy, simple]).map(p => `${p.form}:${p.id}`)).toEqual(['manifest:@x/simple', 'manifest:@x/heavy'])
    expect(() => expandProviders([heavy])).toThrow(UnresolvedProviderDependencyError)

    const again = makeManifest('@x/simple')
    expect(expandProviders([simple, again]).map(p => p.id)).toEqual(['@x/simple'])
  })

  it('манифест и объект с одним id — конфликт', () => {
    expect(() => expandProviders([makeManifest('p'), mk('p')])).toThrow(DuplicateProviderIdError)
  })
})

describe('expandProviders: порядок графа по строковым зависимостям', () => {
  it('донор раньше зависящего, как бы ни стояли в конфиге', () => {
    expect(expandProviders([mk('ui', ['base']), mk('base')]).map(p => p.id)).toEqual(['base', 'ui'])
    expect(expandProviders([mk('app', ['ui']), mk('ui', ['base']), mk('base')]).map(p => p.id)).toEqual(['base', 'ui', 'app'])
  })

  it('независимые провайдеры — в порядке конфига', () => {
    expect(expandProviders([mk('c'), mk('a'), mk('b', ['a'])]).map(p => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('цикл через строковые зависимости — ошибка с цепочкой', () => {
    expect(() => expandProviders([mk('a', ['b']), mk('b', ['a'])])).toThrow(CircularProviderDependencyError)
    expect(() => expandProviders([mk('a', ['b']), mk('b', ['a'])])).toThrow(/a -> b -> a/)
    // Смешанный: объектом a тянет b, строкой b ссылается на a. Цепочка
    // начинается с узла, на котором обход вошёл в цикл.
    expect(() => expandProviders([mk('a', [mk('b', ['a'])])])).toThrow(/b -> a -> b/)
  })

  it('манифесты: зависимость в конфиге после зависящего', () => {
    const ui = makeManifest('@x/ui', {}, { dependencies: ['@x/base'] })
    const base = makeManifest('@x/base')
    expect(expandProviders([ui, base]).map(p => p.id)).toEqual(['@x/base', '@x/ui'])
  })
})
