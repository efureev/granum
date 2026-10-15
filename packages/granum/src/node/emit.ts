/**
 * Сборщик CSS приложения: пять слоёв в фиксированном
 * порядке — tokens, base, themes, components, utilities. Содержимое каждого
 * слоя считается один раз и отдаётся и целиком (`virtual:granum.css`), и по
 * слоям (`virtual:granum/layers/<name>.css`); конкатенация срезов побайтно
 * равна целому.
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
  /** Записи safelist, покрытые статикой манифестов: та же находка, что у сборки провайдера. */
  readonly safelistRedundant: readonly string[]
}

/** Один блок токенов темы в CSS — единственное место, где к имени дописывается `--`. */
function isRootSelector(selector: string): boolean {
  const s = selector.trim()
  return s === '' || s === ':root'
}

export function serializeThemeBlock(block: EffectiveThemeBlock): string | undefined {
  const lines = [...block.tokens.values()]
    .filter(chain => chain.effective !== undefined)
    .sort((a, b) => a.token.localeCompare(b.token, 'en'))
    .map(chain => `  --${chain.token}: ${chain.effective};`)
  if (lines.length === 0)
    return undefined
  return `${block.selector || ':root'} {\n${lines.join('\n')}\n}`
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
 * Слой `themes` по темам в порядке `names`: файлы темы, затем её структурные
 * блоки. Так блоки компонентов, `define` и `tokenOverrides` идут после файла
 * своей темы и выигрывают у него при равной специфичности — приложение главнее
 * пакета, — а блоки одной темы не оказываются после файла следующей.
 * Файлы тем собраны по `items` активных тем (`resolveInlinedCssSources`), так
 * что тема каждого файла есть в `names`.
 */
function themesLayer(
  names: readonly string[],
  files: readonly { readonly theme: string | undefined, readonly css: string }[],
  blocks: ReadonlyMap<string, readonly string[]>,
): string {
  const parts: string[] = []
  for (const name of names) {
    parts.push(...files.filter(file => file.theme === name).map(file => file.css))
    parts.push(...(blocks.get(name) ?? []))
  }
  return parts.join('\n')
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
  const generated = await app.engine.generate({
    classes: new Set(engineInput),
    ...app.engineContribution,
  })
  return { engineInput, generated }
}

export async function emitCss(app: PreparedApp): Promise<EmittedCss> {
  const { resolution, config } = app
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

  // 2. Структурные блоки токенов тем — из общей раскладки слоёв.
  // Блок `:root` — слой tokens, остальные — themes: `:root` и `.dark`
  // равны по специфичности, и в одном слое тему решал бы порядок `names`.
  const rootBlocks: string[] = []
  const themeBlocks = new Map<string, string[]>()
  for (const themeName of resolution.themes.names) {
    for (const block of resolution.tokenLayers.get(themeName) ?? []) {
      const css = serializeThemeBlock(block)
      if (css === undefined)
        continue
      if (isRootSelector(block.selector))
        rootBlocks.push(css)
      else
        themeBlocks.set(themeName, [...(themeBlocks.get(themeName) ?? []), css])
    }
  }

  // 3. CSS компонентов в порядке селекции, побайтно.
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

  // 4. Утилиты движка.
  const { engineInput, generated } = await generateEngineCss(app)
  const safelistRedundant = resolution.safelist.filter(c => resolution.classes.includes(c))

  // 5. Обрезка: `off` не читает лишнего и не меняет ни байта.
  const mode = config.pruneTokens?.mode ?? 'off'
  let prune: TokenPrunePlan | undefined
  let tokensSections = sections.filter(s => s.source.kind === 'tokens').map(s => s.css)
  const themeFileSections = sections.filter(s => s.source.kind === 'theme')
  let themeFileText = (s: PrunableSection): string => s.css
  if (mode !== 'off') {
    prune = planTokenPrune({
      resolution,
      options: config.pruneTokens,
      tokenOverrides: config.themes?.tokenOverrides,
      inlined: sections,
      componentCss,
      appConsumes: app.appScan.consumes,
      engineCss: [generated.css, generated.preflight ?? ''],
    })
    if (mode === 'on') {
      const cut = (s: PrunableSection): string => (s.source.kind === 'base' ? s.css : pruneCssDeclarations(s.css, prune!.isKept).css)
      tokensSections = sections.filter(s => s.source.kind === 'tokens').map(cut)
      themeFileText = cut
    }
  }

  // Preflight движка — базового уровня, поэтому уезжает в `base` и **первым**:
  // инициализация `--un-*` и reset обязаны действовать до стилей компонентов, а
  // не после них. Слой выбирает сборщик, движок про слои не знает.
  const enginePreflight = generated.preflight?.trim()
  const baseSections = sections.filter(s => s.source.kind === 'base').map(s => s.css)

  const layers: Record<LayerName, string> = {
    tokens: [...tokensSections, ...rootBlocks].join('\n'),
    base: (enginePreflight ? [enginePreflight, ...baseSections] : baseSections).join('\n'),
    themes: themesLayer(resolution.themes.names, themeFileSections.map(s => ({ theme: s.source.theme, css: themeFileText(s) })), themeBlocks),
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
