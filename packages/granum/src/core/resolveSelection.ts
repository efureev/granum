import type { GranumComponentDependency } from '../contract'
import type { ProviderNode } from './providerNode'
import type { ComponentKey, ComponentRegistry, RegistryEntry } from './registry'
import { sortedUnique } from './dedupe'
import { CircularDependencyError, ComponentNotFoundError, InvalidComponentKeyError, ProviderNotRegisteredError } from './errors'
import { splitComponentKey, toComponentKey } from './registry'

/**
 * Элемент селекции приложения: квалифицированный ключ `'providerId:Name'`
 * (разделитель — последнее двоеточие, INV-SEL-1) или объектная форма.
 * Короткая форма `'Name'` здесь запрещена (INV-SEL-4).
 */
export type ComponentSelectionItem
  = | string
    | { readonly provider: string, readonly names: 'all' | readonly string[] }

export type ComponentSelection = 'all' | readonly ComponentSelectionItem[]

/** Начальное множество ключей до транзитивного замыкания. */
export function normalizeSelection(
  selection: ComponentSelection | undefined,
  registry: ComponentRegistry,
): ComponentKey[] {
  if (selection === undefined || selection === 'all')
    return [...registry.components.keys()]

  const keys: ComponentKey[] = []
  for (const item of selection) {
    if (typeof item === 'string') {
      keys.push(parseQualifiedKey(item))
      continue
    }
    const { provider, names } = item
    if (!registry.providers.has(provider))
      throw new ProviderNotRegisteredError(provider)
    if (names === 'all') {
      for (const component of registry.getComponentsOfProvider(provider))
        keys.push(toComponentKey(provider, component.name))
      continue
    }
    for (const name of names)
      keys.push(toComponentKey(provider, name))
  }
  return keys
}

function parseQualifiedKey(input: string): ComponentKey {
  const idx = input.lastIndexOf(':')
  if (idx <= 0 || idx === input.length - 1)
    throw new InvalidComponentKeyError(input)
  return input as ComponentKey
}

/** Запись зависимости → квалифицированные ключи; `ownerProviderId` — для короткой формы. */
export function normalizeDependency(
  dep: GranumComponentDependency,
  ownerProviderId: string,
): ComponentKey[] {
  if (typeof dep === 'string') {
    if (dep.includes(':'))
      return [dep as ComponentKey]
    return [toComponentKey(ownerProviderId, dep)]
  }
  return dep.components.map(name => toComponentKey(dep.provider, name))
}

/**
 * Транзитивное замыкание зависимостей одного компонента, включая его самого.
 * Ничего не требует: ссылка на незарегистрированное просто обрывает ветку —
 * для потребителей, которые СРАВНИВАЮТ граф (doctor), а не строят сборку.
 */
export function collectDependencyClosure(registry: ComponentRegistry, root: ComponentKey): Set<ComponentKey> {
  const closure = new Set<ComponentKey>()
  const queue: ComponentKey[] = [root]
  while (queue.length > 0) {
    const key = queue.pop()!
    if (closure.has(key))
      continue
    closure.add(key)
    const entry = registry.components.get(key)
    if (!entry)
      continue
    for (const dep of entry.component.dependencies) {
      for (const depKey of normalizeDependency(dep, entry.provider.id))
        queue.push(depKey)
    }
  }
  return closure
}

export interface ResolvedSelection {
  /** Ключи в порядке post-order DFS: зависимости раньше зависящих (INV-SEL-2). */
  readonly order: readonly ComponentKey[]
  readonly entries: readonly RegistryEntry[]
  /** Провайдеры селекции в порядке первого появления. */
  readonly providers: readonly ProviderNode[]
}

export function resolveSelection(
  registry: ComponentRegistry,
  selection: ComponentSelection | undefined,
): ResolvedSelection {
  const order: ComponentKey[] = []
  const resolved = new Set<ComponentKey>()
  const resolving = new Set<ComponentKey>()
  const stack: string[] = []
  const providerOrder: ProviderNode[] = []
  const seenProviders = new Set<string>()

  const visit = (key: ComponentKey, referencedBy: string | undefined): void => {
    if (resolved.has(key))
      return
    if (resolving.has(key))
      throw new CircularDependencyError([...stack, key])

    const entry = registry.components.get(key)
    if (!entry) {
      const [providerId, componentName] = splitComponentKey(key)
      if (!registry.providers.has(providerId))
        throw new ProviderNotRegisteredError(providerId, referencedBy)
      const available = registry.getComponentsOfProvider(providerId).map(c => c.name)
      throw new ComponentNotFoundError(providerId, componentName, available, referencedBy)
    }

    resolving.add(key)
    stack.push(key)
    for (const dep of entry.component.dependencies) {
      for (const depKey of normalizeDependency(dep, entry.provider.id))
        visit(depKey, key)
    }
    stack.pop()
    resolving.delete(key)
    resolved.add(key)
    order.push(key)

    if (!seenProviders.has(entry.provider.id)) {
      seenProviders.add(entry.provider.id)
      providerOrder.push(entry.provider)
    }
  }

  for (const key of normalizeSelection(selection, registry))
    visit(key, undefined)

  return {
    order,
    entries: order.map(k => registry.components.get(k)!),
    providers: providerOrder,
  }
}

/** Объединение safelist селекции — отсортированное множество (INV-DET-3). */
export function collectSafelist(entries: readonly RegistryEntry[]): string[] {
  return sortedUnique(entries.flatMap(e => e.component.safelist))
}

/** Объединение статических классов селекции (из манифестов). */
export function collectClasses(entries: readonly RegistryEntry[]): string[] {
  return sortedUnique(entries.flatMap(e => e.component.classes))
}

export interface ComponentCssRef {
  readonly providerId: string
  readonly componentName: string
  /** Путь относительно базы провайдера (манифест) или корня раскладки (объект). */
  readonly path: string
}

/** CSS компонентов в порядке селекции, дедуп по паре (провайдер, путь) — INV-CSS-2. */
export function collectComponentCss(entries: readonly RegistryEntry[]): ComponentCssRef[] {
  const seen = new Set<string>()
  const result: ComponentCssRef[] = []
  for (const { provider, component } of entries) {
    for (const path of component.css) {
      const key = `${provider.id}\0${path}`
      if (seen.has(key))
        continue
      seen.add(key)
      result.push({ providerId: provider.id, componentName: component.name, path })
    }
  }
  return result
}
