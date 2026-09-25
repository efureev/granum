/**
 * Единственный источник правды о значениях токенов (R-5, INV-RES-3): какие
 * слои писали каждый токен, в каком порядке и что уедет в CSS. Из него
 * сериализуется CSS и считаются отчёты — расходиться им негде (INV-DIAG-1).
 */
import type { ResolvedThemeItem, ResolvedThemes } from './resolveThemes'

/** Форма `themes.tokenOverrides`: строка — плоская запись в первичный селектор, объект — по селектору. */
export type ThemeTokenOverrides = Partial<Record<
  string,
  Readonly<Record<string, string | Readonly<Record<string, string>>>>
>>

export interface TokenLayerValue {
  /** `provider:<id>` | `component:<Name>` | `app-theme` | `app-override`. */
  readonly source: string
  readonly value: string
  /** Квалифицированный ключ компонента-автора — только у `component:*`. */
  readonly componentKey?: string
  /** Слой написан, но отброшен `strictTokens` и в CSS не уехал (INV-THM-3). */
  readonly skipped?: 'strict-tokens'
}

export interface TokenChain {
  readonly theme: string
  readonly selector: string
  readonly token: string
  /** Все написанные слои в порядке применения, включая пропущенные. */
  readonly layers: TokenLayerValue[]
  /** Значение последнего непропущенного слоя; `undefined` — токена в CSS нет. */
  effective?: string
}

export interface EffectiveThemeBlock {
  readonly selector: string
  readonly tokens: Map<string, TokenChain>
}

export interface CollectTokenLayersOptions {
  readonly strictTokens?: boolean
  readonly onSkippedOverride?: (theme: string, token: string) => void
}

function sourceOf(item: ResolvedThemeItem): { source: string, componentKey?: string } {
  if (item.appDefined)
    return { source: 'app-theme' }
  if (item.componentName)
    return { source: `component:${item.componentName}`, componentKey: `${item.providerId}:${item.componentName}` }
  return { source: `provider:${item.providerId}` }
}

export function collectTokenLayers(
  themes: ResolvedThemes,
  tokenOverrides: ThemeTokenOverrides | undefined,
  options: CollectTokenLayersOptions = {},
): Map<string, EffectiveThemeBlock[]> {
  const strict = !!options.strictTokens
  const result = new Map<string, EffectiveThemeBlock[]>()

  for (const themeName of themes.names) {
    const entry = themes.tokenRegistry[themeName]
    const overrides = tokenOverrides?.[themeName]
    if (!entry && !overrides)
      continue

    const blocks = entry?.blocks ?? []
    const primarySelector = blocks[0]?.selector ?? ':root'

    // Провенанс по паре (селектор, токен); запасной — по имени токена, потому
    // что `define` со `extends` переписывает блок под новым селектором.
    const bySelectorToken = new Map<string, TokenLayerValue[]>()
    const byToken = new Map<string, TokenLayerValue[]>()
    for (const item of themes.items) {
      if (item.themeName !== themeName || !item.tokenDefinition)
        continue
      const selector = item.tokenDefinition.selector ?? primarySelector
      const { source, componentKey } = sourceOf(item)
      for (const [token, value] of Object.entries(item.tokenDefinition.tokens)) {
        const layer: TokenLayerValue = componentKey === undefined ? { source, value } : { source, value, componentKey }
        push(bySelectorToken, `${selector}\0${token}`, layer)
        push(byToken, token, layer)
      }
    }

    const order: string[] = []
    const bySelector = new Map<string, Map<string, TokenChain>>()
    const ensure = (selector: string): Map<string, TokenChain> => {
      let tokens = bySelector.get(selector)
      if (!tokens) {
        tokens = new Map()
        bySelector.set(selector, tokens)
        order.push(selector)
      }
      return tokens
    }

    // `known` — имена по ВСЕЙ теме, поверх всех селекторов: override в другой
    // селектор той же темы обязан проходить.
    const known = new Set<string>()
    for (const block of blocks) {
      const target = ensure(block.selector)
      for (const [token, value] of Object.entries(block.tokens)) {
        const layers = bySelectorToken.get(`${block.selector}\0${token}`)
          ?? byToken.get(token)
          ?? [{ source: 'app-theme', value }]
        target.set(token, { theme: themeName, selector: block.selector, token, layers: [...layers], effective: value })
        known.add(token)
      }
    }

    const applyOverride = (target: Map<string, TokenChain>, selector: string, token: string, value: string): void => {
      const dropped = strict && !known.has(token)
      const layer: TokenLayerValue = dropped
        ? { source: 'app-override', value, skipped: 'strict-tokens' }
        : { source: 'app-override', value }
      const chain = target.get(token)
      if (chain) {
        chain.layers.push(layer)
        if (!dropped)
          chain.effective = value
      }
      else {
        target.set(token, { theme: themeName, selector, token, layers: [layer], ...(dropped ? {} : { effective: value }) })
      }
      if (dropped)
        options.onSkippedOverride?.(themeName, token)
    }

    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (typeof value === 'string') {
          applyOverride(ensure(primarySelector), primarySelector, key, value)
          continue
        }
        // `ensure` ДО цикла: селектор с полностью отброшенными токенами всё
        // равно занимает место в порядке.
        const target = ensure(key)
        for (const [token, tokenValue] of Object.entries(value))
          applyOverride(target, key, token, tokenValue)
      }
    }

    result.set(themeName, order.map(selector => ({ selector, tokens: bySelector.get(selector)! })))
  }

  return result
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list)
    list.push(value)
  else
    map.set(key, [value])
}
