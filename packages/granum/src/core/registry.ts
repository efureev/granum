import type { ComponentNode, ProviderNode } from './providerNode'
import { DuplicateComponentNameError, DuplicateProviderIdError } from './errors'

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

/** Разбивает ключ по ПОСЛЕДНЕМУ двоеточию: `a:b:C` — провайдер `a:b` (INV-SEL-1). */
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
 */
export function resolveComponentTarget(
  input: string,
  registry: ComponentRegistry,
): { key: ComponentKey } | { ambiguous: string[] } {
  if (input.includes(':'))
    return { key: input as ComponentKey }

  const matches = [...registry.components.keys()].filter(k => splitComponentKey(k)[1] === input)
  const [only] = matches
  if (matches.length === 1 && only !== undefined)
    return { key: only }
  return { ambiguous: matches }
}
