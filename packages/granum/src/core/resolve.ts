/**
 * Резолвер: чистая функция над манифестами/объектами и конфигом,
 * результат — `GranumResolution`, единственный вход для всех каналов.
 * Ни FS, ни сети; мемоизация по идентичности входа.
 */
import type { GranumProviderInput } from '../contract'
import type { ProviderNode } from './providerNode'
import type { ComponentRegistry } from './registry'
import type { ComponentCssRef, ComponentSelection, ResolvedSelection } from './resolveSelection'
import type { ComponentThemesInput, GranumModesInput, GranumThemeChoice, ResolvedThemes, ThemeDataInput } from './resolveThemes'
import type { ResolvedTokens } from './tokenLayers'
import { createDebug } from './debug'
import { expandProviders } from './expandProviders'
import { buildRegistry } from './registry'
import { collectClasses, collectComponentCss, collectSafelist, resolveSelection } from './resolveSelection'
import { resolveThemes } from './resolveThemes'
import { collectTokenLayers, tokenValueIn } from './tokenLayers'

/** Часть конфига приложения, которую понимает ядро. */
export interface GranumResolveInput {
  readonly providers: readonly GranumProviderInput[]
  readonly components?: ComponentSelection
  /** Активная тема: id каталога, `providerId:id` или тема-объект приложения. */
  readonly theme?: GranumThemeChoice
  /** Темы для показа рядом с активной. */
  readonly previews?: readonly GranumThemeChoice[]
  readonly modes?: GranumModesInput
  /**
   * Данные тем каталога: активной и превью. Ядро файлов не читает — их
   * читает подготовка приложения по `planThemes`.
   */
  readonly themeData?: ThemeDataInput
  /** Токены компонентов объектной формы, прочитанные из `themesDir`. */
  readonly componentThemes?: ComponentThemesInput
}

export type ResolutionWarning
  = | ResolvedThemes['warnings'][number]
    | { readonly kind: 'override-skipped', readonly mode: string, readonly token: string }
    | { readonly kind: 'provider-without-manifest', readonly providerId: string }

export interface GranumResolution {
  /** Развёрнутый граф провайдеров в топологическом порядке. */
  readonly providers: readonly ProviderNode[]
  readonly registry: ComponentRegistry
  readonly selection: ResolvedSelection
  readonly themes: ResolvedThemes
  /** Значения токенов активной темы и превью по режимам с цепочками слоёв. */
  readonly tokens: ResolvedTokens
  /** Статические классы селекции из манифестов, отсортированы. */
  readonly classes: readonly string[]
  /** Safelist селекции, отсортирован. */
  readonly safelist: readonly string[]
  /** CSS компонентов в порядке эмиссии. */
  readonly componentCss: readonly ComponentCssRef[]
  readonly warnings: readonly ResolutionWarning[]
}

/** Токены компонентов объектной формы — в узлы: манифест приносит их сам, объект — через node-слой. */
function withComponentThemes(providers: ProviderNode[], input: ComponentThemesInput | undefined): ProviderNode[] {
  if (!input)
    return providers
  return providers.map((provider) => {
    const byComponent = input[provider.id]
    if (provider.form !== 'object' || !byComponent)
      return provider
    return {
      ...provider,
      components: provider.components.map(component => (byComponent[component.name] ? { ...component, themeTokens: byComponent[component.name]! } : component)),
    }
  })
}

const cache = new WeakMap<GranumResolveInput, GranumResolution>()
const debug = createDebug('granum:resolve')

export function resolveGranum(input: GranumResolveInput): GranumResolution {
  const cached = cache.get(input)
  if (cached)
    return cached

  const providers = withComponentThemes(expandProviders(input.providers), input.componentThemes)
  const registry = buildRegistry(providers)
  const selection = resolveSelection(registry, input.components)
  const components = selection.entries.map(e => e.component)
  const themes = resolveThemes(providers, {
    ...(input.theme !== undefined ? { theme: input.theme } : {}),
    ...(input.previews !== undefined ? { previews: input.previews } : {}),
    ...(input.modes !== undefined ? { modes: input.modes } : {}),
  }, components, input.themeData)

  const warnings: ResolutionWarning[] = [...themes.warnings]
  for (const provider of providers) {
    if (provider.form === 'object')
      warnings.push({ kind: 'provider-without-manifest', providerId: provider.id })
  }
  const tokens = collectTokenLayers(themes, components, {
    ...(input.modes?.tokenOverrides !== undefined ? { tokenOverrides: input.modes.tokenOverrides } : {}),
    ...(input.modes?.define !== undefined ? { define: input.modes.define } : {}),
    ...(input.modes?.strictTokens !== undefined ? { strictTokens: input.modes.strictTokens } : {}),
    onSkippedOverride: (mode, token) => warnings.push({ kind: 'override-skipped', mode, token }),
  })

  const result: GranumResolution = {
    providers,
    registry,
    selection,
    themes,
    tokens,
    classes: collectClasses(selection.entries),
    safelist: collectSafelist(selection.entries),
    componentCss: collectComponentCss(selection.entries),
    warnings,
  }
  cache.set(input, result)

  debug(
    `providers=[${providers.map(p => p.id).join(', ')}] `
    + `selected=${selection.order.length} [${selection.order.join(', ')}] `
    + `theme=${themes.theme?.id ?? '—'} modes=[${themes.modes.map(m => m.name).join(', ')}] classes=${result.classes.length} safelist=${result.safelist.length}`,
  )
  return result
}

/**
 * Эффективное значение токена в режиме — та же функция для CSS, отчётов и CLI.
 * `theme` — id превью-темы; по умолчанию активная.
 */
export function resolveTokenValue(resolution: GranumResolution, mode: string, token: string, theme?: string): string | undefined {
  const set = theme === undefined || theme === resolution.tokens.active?.themeId
    ? resolution.tokens.active
    : resolution.tokens.previews.find(preview => preview.themeId === theme)
  return tokenValueIn(set, mode, token)
}
