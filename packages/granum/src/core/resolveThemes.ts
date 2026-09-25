/**
 * Активный набор тем и слитый реестр токенов (ТЗ §5.3, INV-THM-1..4).
 * Перенос из v1 на нормализованные узлы; семантика не менялась.
 */
import type { GranumTokenRef, GranumTokenSet } from '../contract'
import type { ComponentNode, ProviderNode } from './providerNode'
import { suppliedThemeNames } from './providerNode'

/** Последний рубеж: ни `names`, ни `define`, ни `defaultThemes` — только `light`. */
export const GRANUM_DEFAULT_THEME_NAMES = ['light'] as const

/** Селектор темы, объявленной приложением: атрибут держит ровно одно значение. */
export function defaultAppThemeSelector(name: string): string {
  return `[data-theme="${name}"]`
}

/**
 * Определение темы на стороне приложения. Не заменяет вклад провайдеров в
 * одноимённую тему, а ложится поверх (INV-THM-2). `extends`/`selector`
 * схлопывают тему в один блок под целевым селектором.
 */
export interface GranumAppThemeDefinition {
  /** Тема со СТРУКТУРНЫМИ токенами, эффективные значения которой взять за основу. */
  readonly extends?: string
  readonly selector?: string
  /** Собственные токены, БЕЗ `--`. */
  readonly tokens?: Readonly<Record<string, string>>
  /** Значения из CSS; материализуется node-слоем до резолюции. Литеральные `tokens` важнее. */
  readonly tokensRef?: GranumTokenRef | string
  readonly label?: string
  readonly colorScheme?: 'light' | 'dark'
}

export interface GranumThemeMeta {
  readonly label?: string
  readonly colorScheme?: 'light' | 'dark'
}

export interface ResolveThemesInput {
  /** `undefined` — по `define`, затем `defaultThemes`, затем фолбэк; `[]` — тем нет. */
  readonly names?: readonly string[]
  readonly define?: Readonly<Record<string, GranumAppThemeDefinition>>
}

export type ThemeNamesSource = 'explicit' | 'app-defined' | 'provider-defaults' | 'fallback'

export type ResolvedThemeWarning
  = | { readonly kind: 'default-theme-without-source', readonly providerId: string, readonly theme: string }
    | { readonly kind: 'partial-theme', readonly theme: string, readonly providersWithout: readonly string[] }
    | { readonly kind: 'multiple-default-themes', readonly themes: readonly string[] }
    | { readonly kind: 'theme-extends-unresolved', readonly theme: string, readonly base: string, readonly reason: 'unknown' | 'opaque' }
    | { readonly kind: 'theme-extends-cycle', readonly chain: readonly string[] }

/** Идентификатор источника для вкладов самого приложения. */
export const APP_THEME_SOURCE = '(app)'

export interface ResolvedThemeItem {
  readonly providerId: string
  readonly themeName: string
  /** Файл темы: путь относительно базы провайдера или URL. */
  readonly cssRef?: string
  readonly tokenDefinition?: GranumTokenSet
  readonly componentName?: string
  readonly appDefined?: true
}

export interface ResolvedThemeSelectorBlock {
  readonly selector: string
  readonly tokens: Record<string, string>
}

export interface ResolvedThemeTokens {
  /** Селектор первичного (первого) блока. */
  readonly selector: string
  /** Токены первичного блока — та же ссылка, что `blocks[0].tokens`. */
  readonly tokens: Record<string, string>
  readonly blocks: ResolvedThemeSelectorBlock[]
}

export interface ResolvedThemes {
  readonly names: readonly string[]
  readonly items: readonly ResolvedThemeItem[]
  readonly tokenRegistry: Readonly<Record<string, ResolvedThemeTokens>>
  readonly namesSource: ThemeNamesSource
  readonly warnings: readonly ResolvedThemeWarning[]
  readonly meta: Readonly<Record<string, GranumThemeMeta>>
}

const DEFAULT_SELECTOR = ':root'

function mergeIntoRegistry(
  registry: Record<string, ResolvedThemeTokens>,
  themeName: string,
  tokenDef: GranumTokenSet,
): void {
  const entry = registry[themeName]
  if (!entry) {
    const selector = tokenDef.selector ?? DEFAULT_SELECTOR
    const block: ResolvedThemeSelectorBlock = { selector, tokens: { ...tokenDef.tokens } }
    registry[themeName] = { selector, tokens: block.tokens, blocks: [block] }
    return
  }
  if (tokenDef.selector === undefined) {
    Object.assign(entry.blocks[0]!.tokens, tokenDef.tokens)
    return
  }
  let block = entry.blocks.find(b => b.selector === tokenDef.selector)
  if (!block) {
    block = { selector: tokenDef.selector, tokens: {} }
    entry.blocks.push(block)
  }
  Object.assign(block.tokens, tokenDef.tokens)
}

/**
 * Провайдеры в порядке графа → компоненты в порядке селекции → `define`
 * приложения (INV-THM-2). Структурное определение темы у провайдера
 * побеждает его же файл (INV-THM-4).
 */
export function resolveThemes(
  providers: readonly ProviderNode[],
  input: ResolveThemesInput = {},
  components: readonly ComponentNode[] = [],
): ResolvedThemes {
  const define = input.define ?? {}
  const { names, namesSource } = resolveThemeNames(providers, input)
  const warnings = collectThemeWarnings(providers, names, namesSource, define)

  if (names.length === 0)
    return { names: [], items: [], tokenRegistry: {}, namesSource, warnings, meta: {} }

  const plan = planAppThemes(names, define)
  warnings.push(...plan.warnings)
  const resolvedNames = plan.needed

  const items: ResolvedThemeItem[] = []
  const tokenRegistry: Record<string, ResolvedThemeTokens> = {}

  for (const provider of providers) {
    for (const themeName of resolvedNames) {
      const tokenDef = provider.theme.tokenDefinitions[themeName]
      const cssRef = provider.theme.themes[themeName]
      if (tokenDef) {
        items.push({ providerId: provider.id, themeName, tokenDefinition: tokenDef })
        mergeIntoRegistry(tokenRegistry, themeName, tokenDef)
      }
      else if (cssRef) {
        items.push({ providerId: provider.id, themeName, cssRef })
      }
    }
  }

  const activeThemes = new Set(resolvedNames)
  for (const component of components) {
    for (const [themeName, tokenDef] of Object.entries(component.tokenDefinitions)) {
      if (!activeThemes.has(themeName))
        continue
      items.push({ providerId: component.providerId, componentName: component.name, themeName, tokenDefinition: tokenDef })
      mergeIntoRegistry(tokenRegistry, themeName, tokenDef)
    }
  }

  for (const themeName of plan.order)
    warnings.push(...applyAppThemeDefinition(tokenRegistry, items, themeName, define[themeName]!))

  const active = new Set(names)
  const prunedRegistry: Record<string, ResolvedThemeTokens> = {}
  for (const themeName of names) {
    const entry = tokenRegistry[themeName]
    if (entry)
      prunedRegistry[themeName] = entry
  }

  return {
    names,
    items: items.filter(item => active.has(item.themeName)),
    tokenRegistry: prunedRegistry,
    namesSource,
    warnings,
    meta: collectThemeMeta(names, define),
  }
}

function flattenThemeTokens(entry: ResolvedThemeTokens | undefined): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const block of entry?.blocks ?? [])
    Object.assign(tokens, block.tokens)
  return tokens
}

function applyAppThemeDefinition(
  registry: Record<string, ResolvedThemeTokens>,
  items: ResolvedThemeItem[],
  themeName: string,
  definition: GranumAppThemeDefinition,
): ResolvedThemeWarning[] {
  const warnings: ResolvedThemeWarning[] = []
  const structural = definition.extends !== undefined || definition.selector !== undefined

  let baseTokens: Record<string, string> = {}
  if (definition.extends !== undefined) {
    baseTokens = flattenThemeTokens(registry[definition.extends])
    if (Object.keys(baseTokens).length === 0) {
      warnings.push({
        kind: 'theme-extends-unresolved',
        theme: themeName,
        base: definition.extends,
        reason: items.some(item => item.themeName === definition.extends && item.cssRef) ? 'opaque' : 'unknown',
      })
    }
  }

  if (!structural && !definition.tokens)
    return warnings

  if (structural) {
    const selector = definition.selector
      ?? registry[themeName]?.blocks[0]?.selector
      ?? defaultAppThemeSelector(themeName)
    const tokens = { ...baseTokens, ...flattenThemeTokens(registry[themeName]), ...definition.tokens }
    registry[themeName] = { selector, tokens, blocks: [{ selector, tokens }] }
  }
  else {
    mergeIntoRegistry(registry, themeName, { tokens: definition.tokens! })
  }

  items.push({
    providerId: APP_THEME_SOURCE,
    themeName,
    appDefined: true,
    tokenDefinition: { selector: registry[themeName]!.selector, tokens: { ...definition.tokens } },
  })
  return warnings
}

function collectThemeMeta(
  names: readonly string[],
  define: Readonly<Record<string, GranumAppThemeDefinition>>,
): Record<string, GranumThemeMeta> {
  const meta: Record<string, GranumThemeMeta> = {}
  for (const name of names) {
    const definition = define[name]
    if (!definition || (definition.label === undefined && definition.colorScheme === undefined))
      continue
    meta[name] = {
      ...(definition.label !== undefined ? { label: definition.label } : {}),
      ...(definition.colorScheme !== undefined ? { colorScheme: definition.colorScheme } : {}),
    }
  }
  return meta
}

/** Какие темы считать (активные + базы `extends`) и в каком порядке применять `define`. */
function planAppThemes(
  names: readonly string[],
  define: Readonly<Record<string, GranumAppThemeDefinition>>,
): { needed: string[], order: string[], warnings: ResolvedThemeWarning[] } {
  const needed = new Set(names)
  const order: string[] = []
  const warnings: ResolvedThemeWarning[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (name: string, chain: readonly string[]): void => {
    const status = state.get(name)
    if (status === 'done')
      return
    if (status === 'visiting') {
      warnings.push({ kind: 'theme-extends-cycle', chain: [...chain, name] })
      return
    }
    const definition = define[name]
    if (!definition) {
      state.set(name, 'done')
      return
    }
    state.set(name, 'visiting')
    if (definition.extends !== undefined) {
      needed.add(definition.extends)
      visit(definition.extends, [...chain, name])
    }
    state.set(name, 'done')
    order.push(name)
  }

  for (const name of names)
    visit(name, [])
  return { needed: [...needed], order, warnings }
}

/** Темы, значения которых понадобятся резолву: активные плюс транзитивные базы `extends` (INV-THM-5). */
export function resolveNeededThemeNames(providers: readonly ProviderNode[], input: ResolveThemesInput = {}): Set<string> {
  const { names } = resolveThemeNames(providers, input)
  return new Set(planAppThemes(names, input.define ?? {}).needed)
}

function resolveThemeNames(
  providers: readonly ProviderNode[],
  input: ResolveThemesInput,
): { names: readonly string[], namesSource: ThemeNamesSource } {
  if (input.names !== undefined)
    return { names: input.names, namesSource: 'explicit' }
  const defined = Object.keys(input.define ?? {})
  if (defined.length > 0)
    return { names: defined, namesSource: 'app-defined' }
  return resolveDefaultThemeNames(providers)
}

function resolveDefaultThemeNames(providers: readonly ProviderNode[]): { names: readonly string[], namesSource: ThemeNamesSource } {
  const names: string[] = []
  const seen = new Set<string>()
  for (const provider of providers) {
    for (const name of provider.theme.defaultThemes) {
      if (typeof name !== 'string' || name.length === 0 || seen.has(name))
        continue
      seen.add(name)
      names.push(name)
    }
  }
  if (names.length === 0)
    return { names: GRANUM_DEFAULT_THEME_NAMES, namesSource: 'fallback' }
  return { names, namesSource: 'provider-defaults' }
}

function collectThemeWarnings(
  providers: readonly ProviderNode[],
  names: readonly string[],
  namesSource: ThemeNamesSource,
  define: Readonly<Record<string, GranumAppThemeDefinition>>,
): ResolvedThemeWarning[] {
  const warnings: ResolvedThemeWarning[] = []
  const supplied = new Map(providers.map(p => [p.id, suppliedThemeNames(p)]))

  for (const provider of providers) {
    for (const name of provider.theme.defaultThemes) {
      if (!supplied.get(provider.id)!.has(name))
        warnings.push({ kind: 'default-theme-without-source', providerId: provider.id, theme: name })
    }
  }

  const themed = providers.filter(p => supplied.get(p.id)!.size > 0)
  if (themed.length > 1) {
    for (const name of names) {
      if (define[name]?.tokens !== undefined || define[name]?.extends !== undefined)
        continue
      const without = themed.filter(p => !supplied.get(p.id)!.has(name)).map(p => p.id)
      if (without.length > 0 && without.length < themed.length)
        warnings.push({ kind: 'partial-theme', theme: name, providersWithout: without })
    }
  }

  if (namesSource === 'provider-defaults' && names.length > 1)
    warnings.push({ kind: 'multiple-default-themes', themes: [...names] })

  return warnings
}
