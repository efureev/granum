/**
 * Нормализованный провайдер: одна форма для объекта контракта и для
 * прочитанного манифеста. Всё ядро ниже работает только с узлами.
 */
import type {
  GranumComponentDependency,
  GranumEngineContribution,
  GranumLoadedManifest,
  GranumManifestEngine,
  GranumProvider,
  GranumProviderInput,
  GranumTokenRef,
  GranumTokenSet,
} from '../contract'
import { isLoadedManifest } from '../contract/manifest'

export type ProviderForm = 'object' | 'manifest'

export interface ThemeNode {
  readonly baseCss?: string
  readonly tokensCss?: string
  readonly themes: Readonly<Record<string, string>>
  readonly defaultThemes: readonly string[]
  readonly tokenDefinitions: Readonly<Record<string, GranumTokenSet>>
  /** Только у объектной формы: манифест приходит уже материализованным. */
  readonly tokenDefinitionsRef: Readonly<Record<string, GranumTokenRef | string>>
  /** Только у манифеста: объявленные токены, с `--`. */
  readonly declares: readonly string[]
}

export interface ComponentNode {
  readonly providerId: string
  readonly name: string
  readonly dependencies: readonly GranumComponentDependency[]
  readonly safelist: readonly string[]
  /** Статические классы из манифеста; у объектной формы пусто. */
  readonly classes: readonly string[]
  /** CSS компонента: пути относительно базы провайдера, в порядке эмиссии. */
  readonly css: readonly string[]
  readonly tokenDefinitions: Readonly<Record<string, GranumTokenSet>>
  readonly tokenDefinitionsRef: Readonly<Record<string, GranumTokenRef>>
  readonly consumesTokens: readonly string[]
  /**
   * Подмножество `consumesTokens`, значение которого обязан дать кто-то извне.
   * У объектной формы и у манифеста формата 2 без поля `requires` равно
   * `consumesTokens`: разделить нечем, и диагностика ведёт себя как прежде.
   */
  readonly requiresTokens: readonly string[]
  readonly dynamicTokens: readonly string[]
  readonly group: string | null
}

export interface ProviderNode {
  readonly id: string
  readonly form: ProviderForm
  /** База раскладки: `baseUrl` объекта или директория манифеста; у объекта без `baseUrl` — `undefined`. */
  readonly baseUrl: string | undefined
  readonly components: readonly ComponentNode[]
  readonly theme: ThemeNode
  /** Вклад в движок, объявленный объектом контракта; у манифестной формы `undefined`. */
  readonly engine: GranumEngineContribution | undefined
  /**
   * Движок, которым порождён артефакт. Только у манифестной формы: у
   * объектной артефакта нет — её классы считает движок приложения здесь и сейчас.
   */
  readonly engineArtifact: GranumManifestEngine | undefined
  /** Исходные зависимости: инстансы тянутся в граф, строки — мягкие. */
  readonly dependencies: readonly (GranumProvider | string)[]
  readonly source: GranumProviderInput
  /**
   * Части составных компонентов: имя части → имя владельца. Только у
   * манифестной формы — части выводит сборка провайдера из его `exports`.
   */
  readonly subcomponents?: ReadonlyMap<string, string>
}

const EMPTY: readonly never[] = Object.freeze([])
const EMPTY_RECORD: Readonly<Record<string, never>> = Object.freeze({})

export function toProviderNode(input: GranumProviderInput): ProviderNode {
  return isLoadedManifest(input) ? fromManifest(input) : fromObject(input)
}

function fromObject(provider: GranumProvider): ProviderNode {
  const theme = provider.theme
  return {
    id: provider.id,
    form: 'object',
    baseUrl: provider.baseUrl,
    components: provider.components.map(descriptor => ({
      providerId: provider.id,
      name: descriptor.name,
      dependencies: descriptor.dependencies ?? EMPTY,
      safelist: descriptor.safelist ?? EMPTY,
      classes: EMPTY,
      css: descriptor.cssFiles ?? EMPTY,
      tokenDefinitions: descriptor.tokenDefinitions ?? EMPTY_RECORD,
      tokenDefinitionsRef: descriptor.tokenDefinitionsRef ?? EMPTY_RECORD,
      consumesTokens: EMPTY,
      requiresTokens: EMPTY,
      dynamicTokens: descriptor.dynamicTokens ?? EMPTY,
      group: descriptor.group ?? null,
    })),
    theme: {
      ...(theme?.baseCss !== undefined ? { baseCss: theme.baseCss } : {}),
      ...(theme?.tokensCss !== undefined ? { tokensCss: theme.tokensCss } : {}),
      themes: theme?.themes ?? EMPTY_RECORD,
      defaultThemes: theme?.defaultThemes ?? EMPTY,
      tokenDefinitions: theme?.tokenDefinitions ?? EMPTY_RECORD,
      tokenDefinitionsRef: theme?.tokenDefinitionsRef ?? EMPTY_RECORD,
      declares: EMPTY,
    },
    engine: provider.engine,
    engineArtifact: undefined,
    dependencies: provider.dependencies ?? EMPTY,
    source: provider,
  }
}

function fromManifest(loaded: GranumLoadedManifest): ProviderNode {
  const { manifest } = loaded
  const subcomponents = new Map<string, string>()
  for (const [name, component] of Object.entries(manifest.components)) {
    for (const part of component.subcomponents ?? [])
      subcomponents.set(part, name)
  }
  return {
    id: manifest.id,
    form: 'manifest',
    baseUrl: loaded.baseUrl,
    components: Object.entries(manifest.components).map(([name, component]) => ({
      providerId: manifest.id,
      name,
      dependencies: component.dependencies,
      safelist: component.safelist,
      classes: component.classes,
      css: component.css,
      tokenDefinitions: component.tokens.declares,
      tokenDefinitionsRef: EMPTY_RECORD,
      consumesTokens: component.tokens.consumes,
      requiresTokens: component.tokens.requires ?? component.tokens.consumes,
      dynamicTokens: component.tokens.dynamic,
      group: component.group,
    })),
    theme: {
      ...(manifest.theme.baseCss !== undefined ? { baseCss: manifest.theme.baseCss } : {}),
      ...(manifest.theme.tokensCss !== undefined ? { tokensCss: manifest.theme.tokensCss } : {}),
      themes: manifest.theme.themes,
      defaultThemes: manifest.theme.defaultThemes,
      tokenDefinitions: manifest.theme.tokenDefinitions,
      tokenDefinitionsRef: EMPTY_RECORD,
      declares: manifest.theme.declares,
    },
    engine: undefined,
    engineArtifact: manifest.engine,
    dependencies: manifest.dependencies,
    source: loaded,
    ...(subcomponents.size > 0 ? { subcomponents } : {}),
  }
}

/**
 * Компонент, чей модуль отдаёт это имя — из подпути `<pkg>/components/<Name>`
 * или из тега разметки: сам компонент либо владелец части. Часть живёт в модуле
 * владельца и без его CSS голая, поэтому guard, селекция и граф провайдера
 * судят по ней владельца. Компонент первичен: имя компонента частью не бывает.
 */
export function ownerOf(provider: ProviderNode, name: string): ComponentNode | undefined {
  const owner = provider.components.find(component => component.name === name)
  if (owner)
    return owner
  const ownerName = provider.subcomponents?.get(name)
  return ownerName === undefined ? undefined : provider.components.find(component => component.name === ownerName)
}

/** Все имена тем, для которых у провайдера есть хоть какой-то вклад (уровень пакета и компонентов). */
export function suppliedThemeNames(node: ProviderNode): Set<string> {
  const names = new Set<string>()
  for (const name of Object.keys(node.theme.themes))
    names.add(name)
  for (const name of Object.keys(node.theme.tokenDefinitions))
    names.add(name)
  for (const name of Object.keys(node.theme.tokenDefinitionsRef))
    names.add(name)
  for (const component of node.components) {
    for (const name of Object.keys(component.tokenDefinitions))
      names.add(name)
    for (const name of Object.keys(component.tokenDefinitionsRef))
      names.add(name)
  }
  return names
}
