import type { ComponentNode, ProviderNode } from './providerNode'
import { DuplicateComponentNameError, DuplicateProviderIdError } from './errors'
import { ownerOf } from './providerNode'

/** Плоский ключ компонента: `providerId:Name`. */
export type ComponentKey = `${string}:${string}`

export interface RegistryEntry {
  readonly provider: ProviderNode
  readonly component: ComponentNode
}

export interface ComponentRegistry {
  readonly providers: ReadonlyMap<string, ProviderNode>
  readonly components: ReadonlyMap<ComponentKey, RegistryEntry>
  getComponentsOfProvider: (providerId: string) => readonly ComponentNode[]
}

export function toComponentKey(providerId: string, name: string): ComponentKey {
  return `${providerId}:${name}`
}

/** Разбивает ключ по ПОСЛЕДНЕМУ двоеточию: `a:b:C` — провайдер `a:b`. */
export function splitComponentKey(key: string): [providerId: string, name: string] {
  const idx = key.lastIndexOf(':')
  return [key.slice(0, idx), key.slice(idx + 1)]
}

/** Единый реестр компонентов всех провайдеров развёрнутого графа. */
export function buildRegistry(providers: readonly ProviderNode[]): ComponentRegistry {
  const providerMap = new Map<string, ProviderNode>()
  const componentMap = new Map<ComponentKey, RegistryEntry>()

  for (const provider of providers) {
    // Каноническая дедупликация — в `expandProviders`; здесь дешёвый guard на
    // случай прямого вызова.
    if (providerMap.has(provider.id))
      throw new DuplicateProviderIdError(provider.id)
    providerMap.set(provider.id, provider)

    const names = new Set<string>()
    for (const component of provider.components) {
      if (names.has(component.name))
        throw new DuplicateComponentNameError(provider.id, component.name)
      names.add(component.name)
      componentMap.set(toComponentKey(provider.id, component.name), { provider, component })
    }
  }

  return {
    providers: providerMap,
    components: componentMap,
    getComponentsOfProvider(providerId) {
      return providerMap.get(providerId)?.components ?? []
    },
  }
}

/**
 * Пользовательский аргумент CLI → ключ реестра. Короткая форма `Name`
 * допустима, только если имя однозначно по всем провайдерам.
 *
 * Часть составного компонента сводится к владельцу, как в guard и селекции:
 * ключ — владельца, `part` — названная часть. Компонент первичен: к частям
 * короткое имя идёт, только если компонента с таким именем нет ни у кого.
 */
export function resolveComponentTarget(
  input: string,
  registry: ComponentRegistry,
): { key: ComponentKey, part?: string } | { ambiguous: string[] } {
  if (input.includes(':')) {
    const key = input as ComponentKey
    const [providerId, name] = splitComponentKey(key)
    const provider = registry.providers.get(providerId)
    const owner = registry.components.has(key) || !provider ? undefined : ownerOf(provider, name)
    return owner ? { key: toComponentKey(providerId, owner.name), part: name } : { key }
  }

  const matches = [...registry.components.keys()].filter(k => splitComponentKey(k)[1] === input)
  const [only] = matches
  if (matches.length === 1 && only !== undefined)
    return { key: only }
  if (matches.length > 1)
    return { ambiguous: matches }
  const owners = [...registry.providers.values()].flatMap((provider) => {
    const owner = provider.subcomponents?.get(input)
    return owner === undefined ? [] : [{ key: toComponentKey(provider.id, owner), part: toComponentKey(provider.id, input) }]
  })
  const [part] = owners
  if (owners.length === 1 && part !== undefined)
    return { key: part.key, part: input }
  return { ambiguous: owners.map(owner => owner.part) }
}
