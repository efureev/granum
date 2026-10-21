/**
 * Нормализованный провайдер: одна форма для объекта контракта и для
 * прочитанного манифеста. Всё ядро ниже работает только с узлами.
 */
import type {
  GranumComponentDependency,
  GranumComponentThemeTokens,
  GranumEngineContribution,
  GranumLoadedManifest,
  GranumManifestEngine,
  GranumProvider,
  GranumProviderInput,
} from '../contract'
import { isLoadedManifest } from '../contract/manifest'

export type ProviderForm = 'object' | 'manifest'

/** Запись каталога тем. `modes`/`defaultMode` — индекс манифеста; у объектной формы их нет до чтения данных. */
export interface ThemeCatalogNode {
  readonly title: string
  readonly description?: string
  readonly docs?: string
  readonly extends?: string
  /** Путь к JSON данных темы относительно базы провайдера. */
  readonly data: string
  readonly modes?: readonly string[]
  readonly defaultMode?: string
  readonly version?: string
  readonly targets?: Readonly<Record<string, string>>
  /**
   * Исходник темы объектного провайдера (C-43): его читает только сборка
   * провайдера, и до неё у записи нет ни данных, ни метаданных.
   */
  readonly source?: string
}

export interface ThemeNode {
  readonly baseCss?: string
  readonly tokensCss?: string
  readonly registry?: string
  readonly defaultTheme?: string
  readonly catalog: Readonly<Record<string, ThemeCatalogNode>>
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
  /**
   * Токены компонента по темам. У манифеста — материализованные сборкой; у
   * объектной формы — те, что прочитал node-слой из `themesDir` (до чтения пусто).
   */
  readonly themeTokens: Readonly<Record<string, GranumComponentThemeTokens>>
  /** Папка токенов по темам — только у объектной формы, путь от корня раскладки. */
  readonly themesDir?: string
  /** `import.meta.url` конфига компонента — только у объектной формы. */
  readonly sourceUrl?: string
  readonly consumesTokens: readonly string[]
  /**
   * Подмножество `consumesTokens`, значение которого обязан дать кто-то извне.
   * У объектной формы и у манифеста формата 2 без поля `requires` равно
   * `consumesTokens`: разделить нечем, и диагностика ведёт себя как прежде.
   */
  readonly requiresTokens: readonly string[]
  /** Подмножество `consumesTokens`, читаемое только через `var(--x, запасное)`; у объектной формы пусто. */
  readonly optionalTokens: readonly string[]
  /** Хуки компонента, с `--`; допускается `*` в конце. */
  readonly hookTokens: readonly string[]
  readonly dynamicTokens: readonly string[]
  readonly group: string | null
}

export interface ProviderNode {
  readonly id: string
  /** Версия пакета из манифеста; у объектной формы её нет. */
  readonly version?: string
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

/** Код предупреждения манифеста, собранного медленным путём из объектного провайдера. */
export const SCANNED_MANIFEST_WARNING = 'scanned-provider'

const EMPTY: readonly never[] = Object.freeze([])
const EMPTY_RECORD: Readonly<Record<string, never>> = Object.freeze({})

export function toProviderNode(input: GranumProviderInput): ProviderNode {
  return isLoadedManifest(input) ? fromManifest(input) : fromObject(input)
}

function objectCatalog(catalog: NonNullable<NonNullable<GranumProvider['theme']>['catalog']>): Record<string, ThemeCatalogNode> {
  return Object.fromEntries(Object.entries(catalog).map(([id, entry]): [string, ThemeCatalogNode] =>
    'source' in entry ? [id, { title: id, data: '', source: entry.source }] : [id, entry]))
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
      themeTokens: EMPTY_RECORD,
      ...(descriptor.themesDir !== undefined ? { themesDir: descriptor.themesDir } : {}),
      ...(descriptor.sourceUrl !== undefined ? { sourceUrl: descriptor.sourceUrl } : {}),
      consumesTokens: EMPTY,
      requiresTokens: EMPTY,
      optionalTokens: EMPTY,
      hookTokens: (descriptor.hookTokens ?? EMPTY).map(t => (t.startsWith('--') ? t : `--${t}`)),
      dynamicTokens: descriptor.dynamicTokens ?? EMPTY,
      group: descriptor.group ?? null,
    })),
    theme: {
      ...(theme?.baseCss !== undefined ? { baseCss: theme.baseCss } : {}),
      ...(theme?.tokensCss !== undefined ? { tokensCss: theme.tokensCss } : {}),
      ...(theme?.registry !== undefined ? { registry: theme.registry } : {}),
      ...(theme?.defaultTheme !== undefined ? { defaultTheme: theme.defaultTheme } : {}),
      catalog: theme?.catalog ? objectCatalog(theme.catalog) : EMPTY_RECORD,
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
  // Просканированный манифест версии пакета не знает: его `0.0.0` — заглушка, а не версия (A-38).
  const scanned = manifest.warnings.some(warning => warning.code === SCANNED_MANIFEST_WARNING)
  return {
    id: manifest.id,
    ...(scanned ? {} : { version: manifest.version }),
    form: 'manifest',
    baseUrl: loaded.baseUrl,
    components: Object.entries(manifest.components).map(([name, component]) => ({
      providerId: manifest.id,
      name,
      dependencies: component.dependencies,
      safelist: component.safelist,
      classes: component.classes,
      css: component.css,
      themeTokens: component.tokens.themes ?? EMPTY_RECORD,
      consumesTokens: component.tokens.consumes,
      requiresTokens: component.tokens.requires ?? component.tokens.consumes,
      optionalTokens: component.tokens.optional ?? EMPTY,
      hookTokens: component.tokens.hooks ?? EMPTY,
      dynamicTokens: component.tokens.dynamic,
      group: component.group,
    })),
    theme: {
      ...(manifest.theme.baseCss !== undefined ? { baseCss: manifest.theme.baseCss } : {}),
      ...(manifest.theme.tokensCss !== undefined ? { tokensCss: manifest.theme.tokensCss } : {}),
      ...(manifest.theme.registry !== undefined ? { registry: manifest.theme.registry } : {}),
      ...(manifest.theme.defaultTheme !== undefined ? { defaultTheme: manifest.theme.defaultTheme } : {}),
      catalog: manifest.theme.catalog ?? EMPTY_RECORD,
      declares: manifest.theme.declares ?? EMPTY,
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

/**
 * Имя без провайдера → тот единственный провайдер, что его объявляет: правило
 * тегов разметки и резолвера авто-импорта. Компонент первичен — к частям
 * составных компонентов имя идёт, только если компонента с таким именем нет ни
 * у кого. Имя у двух провайдеров неоднозначно и в карту не попадает: гадать
 * нельзя ни селекции, ни импорту.
 */
export function uniqueDeclarers(providers: readonly ProviderNode[]): ReadonlyMap<string, ProviderNode> {
  const components = new Map<string, ProviderNode[]>()
  const parts = new Map<string, ProviderNode[]>()
  const declare = (into: Map<string, ProviderNode[]>, name: string, provider: ProviderNode): void => {
    into.set(name, [...(into.get(name) ?? []), provider])
  }
  for (const provider of providers) {
    for (const component of provider.components)
      declare(components, component.name, provider)
    for (const part of provider.subcomponents?.keys() ?? [])
      declare(parts, part, provider)
  }
  const out = new Map<string, ProviderNode>()
  for (const name of new Set([...components.keys(), ...parts.keys()])) {
    const declared = components.get(name) ?? parts.get(name)!
    if (declared.length === 1)
      out.set(name, declared[0]!)
  }
  return out
}

/** Провайдер — владелец каталога тем: объявляет хоть одну тему. */
export function ownsThemes(node: ProviderNode): boolean {
  return Object.keys(node.theme.catalog).length > 0
}
