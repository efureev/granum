/**
 * Резолвер: чистая функция над манифестами/объектами и конфигом,
 * результат — `GranumResolution`, единственный вход для всех каналов.
 * Ни FS, ни сети; мемоизация по идентичности входа.
 */
import type { GranumProviderInput } from '../contract'
import type { ProviderNode } from './providerNode'
import type { ComponentRegistry } from './registry'
import type { ComponentCssRef, ComponentSelection, ResolvedSelection } from './resolveSelection'
import type { ComponentThemesInput, GranumActivation, GranumThemeConfig, ResolvedThemes, ThemeDataInput } from './resolveThemes'
import type { ResolvedTokens, ThemeTokenSet } from './tokenLayers'
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
  /** Темы сборки: основная и дополнительные, у каждой свои режимы. */
  readonly themes?: readonly GranumThemeConfig[]
  /** Атрибут, шаблон пары и системная схема — общие на все темы. */
  readonly activation?: GranumActivation
  /**
   * Данные тем каталога, перечисленных в `themes`. Ядро файлов не читает — их
   * читает подготовка приложения по `planThemes`.
   */
  readonly themeData?: ThemeDataInput
  /** Токены компонентов объектной формы, прочитанные из `themesDir`. */
  readonly componentThemes?: ComponentThemesInput
}

export type ResolutionWarning
  = | ResolvedThemes['warnings'][number]
    | { readonly kind: 'override-skipped', readonly theme: string, readonly mode: string, readonly token: string }
    | { readonly kind: 'provider-without-manifest', readonly providerId: string }

export interface GranumResolution {
  /** Развёрнутый граф провайдеров в топологическом порядке. */
  readonly providers: readonly ProviderNode[]
  readonly registry: ComponentRegistry
  readonly selection: ResolvedSelection
  readonly themes: ResolvedThemes
  /** Значения токенов тем сборки по режимам с цепочками слоёв. */
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
    ...(input.themes !== undefined ? { themes: input.themes } : {}),
    ...(input.activation !== undefined ? { activation: input.activation } : {}),
  }, components, input.themeData)

  const warnings: ResolutionWarning[] = [...themes.warnings]
  for (const provider of providers) {
    if (provider.form === 'object')
      warnings.push({ kind: 'provider-without-manifest', providerId: provider.id })
  }
  const tokens = collectTokenLayers(themes, components, {
    onSkippedOverride: (theme, mode, token) => warnings.push({ kind: 'override-skipped', theme, mode, token }),
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
    + `themes=[${themes.themes.map(t => `${t.theme.id}${t.isDefault ? '*' : ''}(${t.modes.map(m => m.name).join(', ')})`).join(', ')}] classes=${result.classes.length} safelist=${result.safelist.length}`,
  )
  return result
}

/**
 * Эффективное значение токена в режиме — та же функция для CSS, отчётов и CLI.
 * `theme` — id темы сборки; по умолчанию основная.
 */
export function resolveTokenValue(resolution: GranumResolution, mode: string, token: string, theme?: string): string | undefined {
  return tokenValueIn(themeTokenSet(resolution, theme), mode, token)
}

/** Значения темы сборки; без `theme` — основной. */
export function themeTokenSet(resolution: GranumResolution, theme?: string): ThemeTokenSet | undefined {
  return theme === undefined ? resolution.tokens.default : resolution.tokens.themes.find(set => set.themeId === theme)
}
