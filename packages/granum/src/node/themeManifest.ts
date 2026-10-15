/**
 * Манифест тем для рантайма: имена, селекторы и способ активации
 * из той же резолюции, из которой эмитится CSS.
 */
import type { GranumResolution } from '../core/resolve'
import type { GranumThemeActivation, GranumThemeEntry, GranumThemeManifest } from '../runtime/manifest'
import { resolveThemeActivation } from '../runtime/manifest'

export interface GranumThemeManifestOptions {
  /** Класть ли значения токенов по селекторам. По умолчанию `false`. */
  readonly includeTokens?: boolean
  /** Явная активация для тем, чей селектор не выразить одной операцией над элементом. */
  readonly activations?: Readonly<Record<string, GranumThemeActivation>>
}

export function getThemeManifest(resolution: GranumResolution, options: GranumThemeManifestOptions = {}): GranumThemeManifest {
  const { themes, tokenLayers } = resolution
  const overrides = options.activations ?? {}

  const entries: GranumThemeEntry[] = themes.names.map((name) => {
    const registry = themes.tokenRegistry[name]
    const blocks = tokenLayers.get(name)
    // Селектор файла темы — первым: в слое тем файл идёт раньше блоков своей
    // темы. Без него активация темы-файла зависела бы от того, есть ли в
    // селекции компонент со своим блоком этой темы.
    const fileSelectors = themes.items.flatMap(item => (item.themeName === name && item.file ? [item.file.selector] : []))
    const blockSelectors = blocks?.length
      ? blocks.map(block => block.selector)
      : registry?.blocks.map(block => block.selector) ?? []
    const selectors = [...new Set([...fileSelectors, ...blockSelectors])]
    const activation = overrides[name] ?? resolveThemeActivation(selectors)
    const meta = themes.meta[name]

    const entry: GranumThemeEntry = {
      name,
      selectors,
      activation,
      ...(meta?.label !== undefined ? { label: meta.label } : {}),
      ...(meta?.colorScheme !== undefined ? { colorScheme: meta.colorScheme } : {}),
    }
    if (options.includeTokens) {
      entry.tokens = Object.fromEntries((blocks ?? []).map(block => [
        block.selector,
        Object.fromEntries([...block.tokens.values()].filter(c => c.effective !== undefined).map(c => [c.token, c.effective!])),
      ]))
    }
    return entry
  })

  return { themes: entries, defaultTheme: entries[0]?.name ?? '' }
}
