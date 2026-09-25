/**
 * Резолвер (ТЗ §8): чистая функция над манифестами/объектами и конфигом,
 * результат — `GranumResolution`, единственный вход для всех каналов
 * (INV-RES-1). Ни FS, ни сети (INV-RES-2); мемоизация по идентичности входа.
 */
import type { GranumProviderInput } from '../contract'
import type { ProviderNode } from './providerNode'
import type { ComponentRegistry } from './registry'
import type { ComponentCssRef, ComponentSelection, ResolvedSelection } from './resolveSelection'
import type { ResolvedThemes, ResolveThemesInput } from './resolveThemes'
import type { EffectiveThemeBlock, ThemeTokenOverrides } from './tokenLayers'
import { createDebug } from './debug'
import { expandProviders } from './expandProviders'
import { buildRegistry } from './registry'
import { collectClasses, collectComponentCss, collectSafelist, resolveSelection } from './resolveSelection'
import { resolveThemes } from './resolveThemes'
import { collectTokenLayers } from './tokenLayers'

export interface GranumThemesInput extends ResolveThemesInput {
  readonly tokenOverrides?: ThemeTokenOverrides
  /** Override токена, не объявленного пакетным слоем, отбрасывается (INV-THM-3). */
  readonly strictTokens?: boolean
}

/** Часть конфига приложения, которую понимает ядро. */
export interface GranumResolveInput {
  readonly providers: readonly GranumProviderInput[]
  readonly components?: ComponentSelection
  readonly themes?: GranumThemesInput
}

export type ResolutionWarning
  = | ResolvedThemes['warnings'][number]
    | { readonly kind: 'override-skipped', readonly theme: string, readonly token: string }
    | { readonly kind: 'provider-without-manifest', readonly providerId: string }

export interface GranumResolution {
  /** Развёрнутый граф провайдеров в топологическом порядке. */
  readonly providers: readonly ProviderNode[]
  readonly registry: ComponentRegistry
  readonly selection: ResolvedSelection
  readonly themes: ResolvedThemes
  /** Тема → блоки по селекторам с цепочками слоёв каждого токена. */
  readonly tokenLayers: ReadonlyMap<string, readonly EffectiveThemeBlock[]>
  /** Статические классы селекции из манифестов, отсортированы. */
  readonly classes: readonly string[]
  /** Safelist селекции, отсортирован. */
  readonly safelist: readonly string[]
  /** CSS компонентов в порядке эмиссии. */
  readonly componentCss: readonly ComponentCssRef[]
  readonly warnings: readonly ResolutionWarning[]
}

const cache = new WeakMap<GranumResolveInput, GranumResolution>()
const debug = createDebug('granum:resolve')

export function resolveGranum(input: GranumResolveInput): GranumResolution {
  const cached = cache.get(input)
  if (cached)
    return cached

  const providers = expandProviders(input.providers)
  const registry = buildRegistry(providers)
  const selection = resolveSelection(registry, input.components)
  const themes = resolveThemes(providers, input.themes, selection.entries.map(e => e.component))

  const warnings: ResolutionWarning[] = [...themes.warnings]
  for (const provider of providers) {
    if (provider.form === 'object')
      warnings.push({ kind: 'provider-without-manifest', providerId: provider.id })
  }
  const tokenLayers = collectTokenLayers(themes, input.themes?.tokenOverrides, {
    ...(input.themes?.strictTokens !== undefined ? { strictTokens: input.themes.strictTokens } : {}),
    onSkippedOverride: (theme, token) => warnings.push({ kind: 'override-skipped', theme, token }),
  })

  const result: GranumResolution = {
    providers,
    registry,
    selection,
    themes,
    tokenLayers,
    classes: collectClasses(selection.entries),
    safelist: collectSafelist(selection.entries),
    componentCss: collectComponentCss(selection.entries),
    warnings,
  }
  cache.set(input, result)

  debug(
    `providers=[${providers.map(p => p.id).join(', ')}] `
    + `selected=${selection.order.length} [${selection.order.join(', ')}] `
    + `themes=[${themes.names.join(', ')}] classes=${result.classes.length} safelist=${result.safelist.length}`,
  )
  return result
}

/** Эффективное значение токена темы под селектором — та же функция для CSS, отчётов и CLI (R-5). */
export function resolveTokenValue(
  resolution: GranumResolution,
  theme: string,
  token: string,
  selector?: string,
): string | undefined {
  const blocks = resolution.tokenLayers.get(theme)
  if (!blocks)
    return undefined
  for (const block of blocks) {
    if (selector !== undefined && block.selector !== selector)
      continue
    const chain = block.tokens.get(token)
    if (chain?.effective !== undefined)
      return chain.effective
  }
  return undefined
}
