/**
 * Манифест тем для рантайма (T-4, RT-2): имена, селекторы и способ активации
 * из той же резолюции, из которой эмитится CSS.
 */
import type { GranumResolution } from '../core/resolve'
import type { GranumThemeActivation, GranumThemeEntry, GranumThemeManifest } from '../runtime/manifest'
import { resolveThemeActivation } from '../runtime/manifest'

export interface GranumThemeManifestOptions {
  /** Класть ли значения токенов по селекторам. По умолчанию `false`. */
  readonly includeTokens?: boolean
  /** Явная активация для тем, у которых селектор из CSS-файла не вывести. */
  readonly activations?: Readonly<Record<string, GranumThemeActivation>>
}

export function getThemeManifest(resolution: GranumResolution, options: GranumThemeManifestOptions = {}): GranumThemeManifest {
  const { themes, tokenLayers } = resolution
  const overrides = options.activations ?? {}

  const entries: GranumThemeEntry[] = themes.names.map((name) => {
    const registry = themes.tokenRegistry[name]
    const blocks = tokenLayers.get(name)
    const selectors = blocks?.length
      ? blocks.map(block => block.selector)
      : registry?.blocks.map(block => block.selector) ?? []
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
