/**
 * Сборщик CSS приложения (A-9…A-15, INV-CSS-1…7): пять слоёв в фиксированном
 * порядке — tokens, base, themes, components, utilities. Содержимое каждого
 * слоя считается один раз и отдаётся и целиком (`virtual:granum.css`), и по
 * слоям (`virtual:granum/layers/<name>.css`); конкатенация срезов побайтно
 * равна целому (INV-CSS-4).
 */
import type { EffectiveThemeBlock } from '../core/tokenLayers'
import type { EngineOutput } from '../engine/types'
import type { PreparedApp } from './prepare'
import type { PrunableSection, TokenPrunePlan } from './tokenPrune'
import { sortedUnique } from '../core/dedupe'
import { CssReadError } from '../core/errors'
import { readCss } from './css'
import { resolveInlinedCssSources, resolveProviderPath } from './inlinedCss'
import { pruneCssDeclarations } from './pruneCssDeclarations'
import { planTokenPrune } from './tokenPrune'

export const LAYER_NAMES = ['tokens', 'base', 'themes', 'components', 'utilities'] as const
export type LayerName = typeof LAYER_NAMES[number]

export interface EmittedCss {
  /** Содержимое слоёв без обёрток `@layer`. */
  readonly layers: Readonly<Record<LayerName, string>>
  /** Полный CSS: объявление порядка слоёв + блоки (или плоская конкатенация). */
  readonly css: string
  readonly engine: EngineOutput
  /** План обрезки — при `mode: 'report' | 'on'`. */
  readonly prune: TokenPrunePlan | undefined
  /** Классы, поданные движку: манифесты + safelist + приложение. */
  readonly engineInput: readonly string[]
  /** Записи safelist, покрытые статикой манифестов (INV-MAN-4 на стороне приложения). */
  readonly safelistRedundant: readonly string[]
}

/** Один блок токенов темы в CSS — единственное место, где к имени дописывается `--`. */
export function serializeThemeBlock(block: EffectiveThemeBlock): string | undefined {
  const lines = [...block.tokens.values()]
    .filter(chain => chain.effective !== undefined)
    .sort((a, b) => a.token.localeCompare(b.token, 'en'))
    .map(chain => `  --${chain.token}: ${chain.effective};`)
  if (lines.length === 0)
    return undefined
  return `${block.selector || ':root'} {\n${lines.join('\n')}\n}`
}

export function wrapLayers(layers: Readonly<Record<LayerName, string>>, options: { readonly layers?: boolean, readonly layerPrefix?: string }): string {
  const useLayers = options.layers !== false
  const prefix = options.layerPrefix ?? 'granum'
  const parts: string[] = []
  if (useLayers)
    parts.push(`@layer ${LAYER_NAMES.map(n => `${prefix}.${n}`).join(', ')};`)
  for (const name of LAYER_NAMES) {
    const body = layers[name]
    if (!body.trim())
      continue
    parts.push(useLayers ? `@layer ${prefix}.${name} {\n${body}\n}` : body)
  }
  return `${parts.join('\n')}\n`
}

export async function emitCss(app: PreparedApp): Promise<EmittedCss> {
  const { resolution, config, engine } = app
  const byId = new Map(resolution.providers.map(p => [p.id, p]))

  // 1. Инлайнимые файлы: tokens → base → файлы тем.
  const inlined = resolveInlinedCssSources(resolution)
  const sections: PrunableSection[] = await Promise.all(inlined.map(async (source) => {
    try {
      return { source, css: await readCss(source.path) }
    }
    catch (cause) {
      throw new CssReadError(source.providerId, source.kind === 'theme' ? 'theme' : source.kind, source.theme ?? source.kind, source.path, { cause })
    }
  }))

  // 2. Структурные блоки токенов тем — из общей раскладки слоёв (R-5).
  const themeBlocks: string[] = []
  for (const themeName of resolution.themes.names) {
    for (const block of resolution.tokenLayers.get(themeName) ?? []) {
      const css = serializeThemeBlock(block)
      if (css !== undefined)
        themeBlocks.push(css)
    }
  }

  // 3. CSS компонентов в порядке селекции (INV-CSS-2), побайтно (INV-CSS-5).
  const componentCss = await Promise.all(resolution.componentCss.map(async (ref) => {
    const provider = byId.get(ref.providerId)
    const path = resolveProviderPath(ref.path, provider?.baseUrl)
    try {
      return await readCss(path)
    }
    catch (cause) {
      throw new CssReadError(ref.providerId, 'component', ref.componentName, path, { cause })
    }
  }))

  // 4. Утилиты: классы манифестов ∪ safelist ∪ приложение (INV-CSS-3).
  // `reextractLost` — классы, которые были в манифесте и не нашлись при
  // пересчёте. Они обязаны остаться видны в `unmatched`: пересчёт не имеет
  // права делать потерю тише, чем она была (A-E7, INV-DIAG-2).
  const engineInput = sortedUnique([...resolution.classes, ...resolution.safelist, ...app.appScan.classes, ...app.reextractLost])
  const generated = await engine.generate({
    classes: new Set(engineInput),
    ...(config.themes && 'engineTheme' in config.themes ? {} : {}),
    ...app.engineContribution,
  })
  const safelistRedundant = resolution.safelist.filter(c => resolution.classes.includes(c))

  // 5. Обрезка: `off` не читает лишнего и не меняет ни байта (INV-TOK-1).
  const mode = config.pruneTokens?.mode ?? 'off'
  let prune: TokenPrunePlan | undefined
  let tokensSections = sections.filter(s => s.source.kind === 'tokens').map(s => s.css)
  let themeFileSections = sections.filter(s => s.source.kind === 'theme').map(s => s.css)
  if (mode !== 'off') {
    prune = planTokenPrune({
      resolution,
      options: config.pruneTokens,
      tokenOverrides: config.themes?.tokenOverrides,
      inlined: sections,
      componentCss,
      appConsumes: app.appScan.consumes,
    })
    if (mode === 'on') {
      const cut = (s: PrunableSection): string => (s.source.kind === 'base' ? s.css : pruneCssDeclarations(s.css, prune!.isKept).css)
      tokensSections = sections.filter(s => s.source.kind === 'tokens').map(cut)
      themeFileSections = sections.filter(s => s.source.kind === 'theme').map(cut)
    }
  }

  // Preflight движка — базового уровня, поэтому уезжает в `base` и **первым**:
  // инициализация `--un-*` и reset обязаны действовать до стилей компонентов, а
  // не после них. Слой выбирает сборщик, движок про слои не знает (E-13, E-15).
  const enginePreflight = generated.preflight?.trim()
  const baseSections = sections.filter(s => s.source.kind === 'base').map(s => s.css)

  const layers: Record<LayerName, string> = {
    tokens: tokensSections.join('\n'),
    base: (enginePreflight ? [enginePreflight, ...baseSections] : baseSections).join('\n'),
    themes: [...themeBlocks, ...themeFileSections].join('\n'),
    components: componentCss.join('\n'),
    utilities: generated.css,
  }

  return {
    layers,
    css: wrapLayers(layers, config.css ?? {}),
    engine: generated,
    prune,
    engineInput,
    safelistRedundant,
  }
}
