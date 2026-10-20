/**
 * Сборщик CSS приложения: пять слоёв в фиксированном
 * порядке — tokens, base, themes, components, utilities. Содержимое каждого
 * слоя считается один раз и отдаётся и целиком (`virtual:granum.css`), и по
 * слоям (`virtual:granum/layers/<name>.css`); конкатенация срезов побайтно
 * равна целому.
 */
import type { EngineOutput } from '../engine/types'
import type { PreparedApp } from './prepare'
import type { PrunableSection, TokenPrunePlan } from './tokenPrune'
import { sortedUnique } from '../core/dedupe'
import { CssReadError } from '../core/errors'
import { readCss } from './css'
import { resolveInlinedCssSources, resolveProviderPath } from './inlinedCss'
import { pruneCssDeclarations } from './pruneCssDeclarations'
import { emitThemeCss } from './themeCss'
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
  /**
   * Слой `themes` каждой темы превью без обёрток, по id. При
   * `css.previews: 'separate'` этих блоков нет в `layers.themes`.
   */
  readonly previews: Readonly<Record<string, string>>
  /** Классы, поданные движку: манифесты + safelist + приложение. */
  readonly engineInput: readonly string[]
  /** Записи safelist, покрытые статикой манифестов: та же находка, что у сборки провайдера. */
  readonly safelistRedundant: readonly string[]
}

export interface LayerWrapOptions {
  readonly layers?: boolean
  readonly layerPrefix?: string
}

/** Объявление порядка слоёв — первая строка вывода. */
export function layerOrderDeclaration(options: LayerWrapOptions): string {
  if (options.layers === false)
    return ''
  const prefix = options.layerPrefix ?? 'granum'
  return `@layer ${LAYER_NAMES.map(n => `${prefix}.${n}`).join(', ')};\n`
}

function orderDeclaration(prefix: string): string {
  return `@layer ${LAYER_NAMES.map(n => `${prefix}.${n}`).join(', ')};`
}

/** Первый слой с непустым содержимым: он несёт объявление порядка. */
function firstNonEmpty(layers: Readonly<Record<LayerName, string>>): LayerName | undefined {
  return LAYER_NAMES.find(name => layers[name].trim().length > 0)
}

export function wrapLayers(layers: Readonly<Record<LayerName, string>>, options: LayerWrapOptions): string {
  const useLayers = options.layers !== false
  const prefix = options.layerPrefix ?? 'granum'
  const parts: string[] = []
  if (useLayers)
    parts.push(orderDeclaration(prefix))
  for (const name of LAYER_NAMES) {
    const body = layers[name]
    if (!body.trim())
      continue
    parts.push(useLayers ? `@layer ${prefix}.${name} {\n${body}\n}` : body)
  }
  return `${parts.join('\n')}\n`
}

/**
 * Один слой как самостоятельный файл.
 *
 * Обёртка `@layer` здесь обязательна: без неё срез отдавал бы нелейерный CSS, то
 * есть ровно наоборот тому, что обещает слой. Объявление порядка несёт файл
 * первого непустого слоя — тогда конкатенация всех срезов в порядке слоёв
 * побайтно равна `virtual:granum.css`, а не повторяет объявление
 * пять раз.
 *
 * Пустой слой даёт пустую строку: ассета и запроса за ним быть не должно.
 */
export function wrapLayer(
  layers: Readonly<Record<LayerName, string>>,
  name: LayerName,
  options: LayerWrapOptions,
  /** `declareOrder: false` — порядок объявлен где-то ещё (например отдельным ассетом). */
  slice: { readonly declareOrder?: boolean } = {},
): string {
  const body = layers[name]
  if (!body.trim())
    return ''
  const useLayers = options.layers !== false
  const prefix = options.layerPrefix ?? 'granum'
  const parts: string[] = []
  if (useLayers && slice.declareOrder !== false && firstNonEmpty(layers) === name)
    parts.push(orderDeclaration(prefix))
  parts.push(useLayers ? `@layer ${prefix}.${name} {\n${body}\n}` : body)
  return `${parts.join('\n')}\n`
}

/**
 * Утилиты движка: классы манифестов ∪ safelist ∪ приложение.
 *
 * `reextractLost` — классы выбранных компонентов, которые были в манифесте и не
 * нашлись при пересчёте. Они обязаны остаться видны в `unmatched`: пересчёт не
 * имеет права делать потерю тише, чем она была.
 *
 * Отдельной функцией, потому что тот же вывод нужен `granum prune`: утилиты —
 * корень обрезки, и план диагностики обязан совпадать с планом сборки.
 */
export async function generateEngineCss(app: PreparedApp): Promise<{ engineInput: string[], generated: EngineOutput }> {
  const { resolution } = app
  const engineInput = sortedUnique([...resolution.classes, ...resolution.safelist, ...app.appScan.classes, ...app.reextractLost])
  const darkSelector = darkModesSelector(resolution)
  const generated = await app.engine.generate({
    classes: new Set(engineInput),
    ...app.engineContribution,
    ...(darkSelector !== undefined ? { darkSelector } : {}),
  })
  return { engineInput, generated }
}

/** Пары режимов активной темы с `colorScheme: 'dark'` — селектор варианта `dark:` движка (E-20). */
export function darkModesSelector(resolution: PreparedApp['resolution']): string | undefined {
  const { attribute } = resolution.themes.activation
  const dark = resolution.themes.modes.filter(mode => mode.colorScheme === 'dark')
  return dark.length > 0 ? dark.map(mode => `[${attribute}="${mode.value}"]`).join(', ') : undefined
}

export async function emitCss(app: PreparedApp): Promise<EmittedCss> {
  const { resolution, config } = app
  const byId = new Map(resolution.providers.map(p => [p.id, p]))

  // 1. Инлайнимые файлы: tokens → base.
  const inlined = resolveInlinedCssSources(resolution)
  const sections: PrunableSection[] = await Promise.all(inlined.map(async (source) => {
    try {
      return { source, css: await readCss(source.path) }
    }
    catch (cause) {
      throw new CssReadError(source.providerId, source.kind, source.kind, source.path, { cause })
    }
  }))

  // 2. CSS компонентов в порядке селекции, побайтно.
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

  // 3. Утилиты движка.
  const { engineInput, generated } = await generateEngineCss(app)
  const safelistRedundant = resolution.safelist.filter(c => resolution.classes.includes(c))

  // 4. Обрезка: `off` не читает лишнего и не меняет ни байта.
  const mode = config.pruneTokens?.mode ?? 'off'
  let prune: TokenPrunePlan | undefined
  let tokensSections = sections.filter(s => s.source.kind === 'tokens').map(s => s.css)
  if (mode !== 'off') {
    prune = planTokenPrune({
      resolution,
      options: config.pruneTokens,
      inlined: sections,
      componentCss,
      appConsumes: app.appScan.consumes,
      engineCss: [generated.css, generated.preflight ?? ''],
    })
    if (mode === 'on')
      tokensSections = sections.filter(s => s.source.kind === 'tokens').map(s => pruneCssDeclarations(s.css, prune!.isKept).css)
  }

  // 5. Темы: блоки активной темы и превью из резолюции; при `on` — без обрезанных токенов (T-14).
  const themeCss = emitThemeCss(resolution, mode === 'on' && prune ? prune.isKept : undefined)

  // Preflight движка — базового уровня, поэтому уезжает в `base` и **первым**:
  // инициализация `--un-*` и reset обязаны действовать до стилей компонентов, а
  // не после них. Слой выбирает сборщик, движок про слои не знает.
  const enginePreflight = generated.preflight?.trim()
  const baseSections = [...sections.filter(s => s.source.kind === 'base').map(s => s.css), ...themeCss.base]

  // Блоки превью уходят из общего листа целиком — по владельцу, а не по селектору.
  const previewBlocks = new Set(themeCss.parts.previews.flatMap(part => part.blocks))
  const themes = config.css?.previews === 'separate'
    ? themeCss.themes.filter(block => !previewBlocks.has(block))
    : themeCss.themes

  const layers: Record<LayerName, string> = {
    tokens: [...tokensSections, ...(themeCss.tokens !== undefined ? [themeCss.tokens] : [])].join('\n'),
    base: (enginePreflight ? [enginePreflight, ...baseSections] : baseSections).join('\n'),
    themes: themes.join('\n'),
    components: componentCss.join('\n'),
    utilities: generated.css,
  }

  return {
    layers,
    css: wrapLayers(layers, config.css ?? {}),
    engine: generated,
    prune,
    previews: Object.fromEntries(themeCss.parts.previews.map(part => [part.id, part.blocks.join('\n')])),
    engineInput,
    safelistRedundant,
  }
}
