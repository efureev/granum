/**
 * Подготовка приложения к эмиссии: конфиг → провайдеры
 * (манифесты через `exports`, объекты — материализованные) → селекция
 * (список или `'imports'`) → одна резолюция → движок с правилами провайдеров.
 * Node-only. Всё ниже (CSS, JS, токены, отчёт) читает только `PreparedApp`.
 */
import type { GranumConfig } from '../config'
import type { GranumProvider, GranumProviderInput } from '../contract'
import type { ProviderNode } from '../core/providerNode'
import type { GranumResolution, GranumThemesInput } from '../core/resolve'
import type { ComponentSelection } from '../core/resolveSelection'
import type { GranumAppThemeDefinition, ThemeFileFacts, ThemeFilesInput } from '../core/resolveThemes'
import type { EngineInput, GranumEngine } from '../engine/types'
import type { AppSourcesScan } from './appSources'
import type { ProviderEngineDecision } from './dialects'
import { resolve as resolvePath } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { isLoadedManifest } from '../contract/manifest'
import { sortedUnique } from '../core/dedupe'
import { DuplicateProviderIdError, TokenRefError } from '../core/errors'
import { ownerOf, toProviderNode } from '../core/providerNode'
import { splitComponentKey } from '../core/registry'
import { resolveGranum } from '../core/resolve'
import { APP_THEME_SOURCE } from '../core/resolveThemes'
import { scanAppSources } from './appSources'
import { readCssSync } from './css'
import { parseCssTokenBlocksFromText, tokenSetFromCssSync } from './cssTokens'
import { reconcileProviderEngines } from './dialects'
import { resolveProviderPath } from './inlinedCss'
import { loadPackageManifest } from './manifest'
import { materializeProviderRefs } from './materializeRefs'
import { collectProviderInstances, scanObjectProvider } from './scanProvider'

export interface PreparedApp {
  readonly config: GranumConfig
  readonly root: string
  readonly resolution: GranumResolution
  readonly engine: GranumEngine
  /** Время частей подготовки в миллисекундах: манифесты с пересчётом, скан исходников, резолюция. */
  readonly timings: { readonly providers: number, readonly appScan: number, readonly resolve: number }
  readonly appScan: AppSourcesScan
  /**
   * Селекция, поданная резолверу: список из конфига либо вычисленный по
   * импортам и тегам (`'imports'`); `undefined` — `'all'`. Семена, от которых
   * `granum explain` строит цепочку: другой источник разошёлся бы с селекцией.
   */
  readonly selectionInput: ComponentSelection | undefined
  /** Правила/варианты/preflights провайдеров графа, с источниками. */
  readonly engineContribution: Pick<EngineInput, 'rules' | 'variants' | 'preflights' | 'sources'>
  /** Решение по каждому провайдеру: диалект, отпечаток, откуда взяты классы. */
  readonly engineDecisions: readonly ProviderEngineDecision[]
  /**
   * Классы выбранных компонентов, потерянные пересчётом: подаются движку, чтобы
   * остаться в `unmatched`. Потерянное у невыбранных во вход не идёт — их
   * классов там не было и до пересчёта; пакет целиком описывает `lost` решения.
   */
  readonly reextractLost: readonly string[]
  readonly warnings: readonly PreparedWarning[]
}

export type PreparedWarning
  = | { readonly kind: 'provider-without-manifest', readonly providerId: string }
    /** Объектный провайдер просканирован по `dist`: классы и токены известны, но без графа бандлера. */
    | { readonly kind: 'provider-scanned', readonly providerId: string }
    | { readonly kind: 'imports-without-app-sources' }
    /** `appSources` не задан: разметку приложения никто не сканирует, её классы CSS не получат. */
    | { readonly kind: 'app-sources-unset' }

/**
 * Провайдер по имени пакета — манифест через `exports`; объект —
 * материализованный.
 *
 * Объектные доноры из `dependencies` подключаются наравне с перечисленными:
 * каждый инстанс материализуется один раз, а ссылки на него в `dependencies`
 * сводятся к `id`. Иначе материализация (и скан по `dist`) давала бы донору
 * новый объект, `dependencies` соседа держали бы старый, и проверка
 * идентичности в графе видела бы два инстанса с одним `id` там, где он один.
 * Строковая зависимость задаёт порядок так же, как объектная, —
 * так же, как в синтетическом манифесте медленного пути.
 */
export function loadProviderInputs(config: Pick<GranumConfig, 'providers'>, root: string): GranumProviderInput[] {
  const out: GranumProviderInput[] = []
  const seen = new Map<string, GranumProvider>()

  const addObject = (provider: GranumProvider, path: readonly string[]): void => {
    const known = seen.get(provider.id)
    if (known !== undefined) {
      if (known !== provider)
        throw new DuplicateProviderIdError(provider.id, [...path, provider.id])
      return
    }
    seen.set(provider.id, provider)
    const materialized = materializeProviderRefs(provider)
    const dependencies = provider.dependencies ?? []
    out.push(dependencies.some(dep => typeof dep !== 'string')
      ? { ...materialized, dependencies: dependencies.map(dep => (typeof dep === 'string' ? dep : dep.id)) }
      : materialized)
    for (const dep of dependencies) {
      if (typeof dep !== 'string')
        addObject(dep, [...path, provider.id])
    }
  }

  for (const entry of config.providers) {
    if (typeof entry === 'string')
      out.push(loadPackageManifest(entry, root))
    else if (isLoadedManifest(entry))
      out.push(entry)
    else
      addObject(entry, [])
  }
  return out
}

/**
 * Медленный путь: объектные провайдеры с раскладкой на диске заменяются
 * синтетическими манифестами; инстансы-доноры, которых нет во входе по id,
 * добавляются и сканируются тоже. Объекты без каталога остаются как есть.
 */
export async function scanProviderInputs(inputs: readonly GranumProviderInput[], engine: GranumEngine, warnings: PreparedWarning[]): Promise<{ resolver: GranumProviderInput[], engineSources: GranumProviderInput[] }> {
  const byId = new Set(inputs.map(i => (isLoadedManifest(i) ? i.manifest.id : i.id)))
  const engineSources = [...inputs]
  const queue = [...inputs]
  for (const input of inputs) {
    if (isLoadedManifest(input))
      continue
    for (const [id, donor] of collectProviderInstances(input)) {
      if (!byId.has(id)) {
        byId.add(id)
        queue.push(donor)
        engineSources.push(donor)
      }
    }
  }
  const resolver: GranumProviderInput[] = []
  for (const input of queue) {
    if (isLoadedManifest(input)) {
      resolver.push(input)
      continue
    }
    const scanned = await scanObjectProvider(input, engine)
    if (scanned) {
      warnings.push({ kind: 'provider-scanned', providerId: input.id })
      resolver.push(scanned)
    }
    else {
      resolver.push(input)
    }
  }
  return { resolver, engineSources }
}

/**
 * `themes.define[*].tokensRef` → литеральные `tokens` (как у провайдеров):
 * относительный путь считается от корня приложения, `as` ссылки становится
 * селектором темы, если явный не задан; литеральные `tokens` важнее файла.
 */
export function materializeAppThemes(themes: GranumThemesInput | undefined, root: string): GranumThemesInput | undefined {
  if (!themes?.define)
    return themes
  let changed = false
  const define: Record<string, GranumAppThemeDefinition> = {}
  for (const [name, definition] of Object.entries(themes.define)) {
    if (!definition.tokensRef) {
      define[name] = definition
      continue
    }
    changed = true
    const ref = typeof definition.tokensRef === 'string' ? { url: definition.tokensRef } : definition.tokensRef
    const url = /^[a-z]+:/i.test(ref.url) ? ref.url : pathToFileURL(resolvePath(root, ref.url)).href
    let parsed
    try {
      parsed = tokenSetFromCssSync(url, {
        ...(ref.selector !== undefined ? { selector: ref.selector } : {}),
        ...(ref.as !== undefined ? { as: ref.as } : {}),
        ...(ref.strict !== undefined ? { strict: ref.strict } : {}),
      })
    }
    catch (cause) {
      throw new TokenRefError(APP_THEME_SOURCE, name, undefined, ref.url, { cause })
    }
    const { tokensRef: _dropped, ...rest } = definition
    define[name] = {
      ...rest,
      tokens: { ...parsed.tokens, ...definition.tokens },
      ...(definition.selector === undefined && ref.as !== undefined ? { selector: ref.as } : {}),
    }
  }
  return changed ? { ...themes, define } : themes
}

/**
 * Теги разметки → ключи селекции: имя берётся, если ровно один
 * провайдер графа его объявляет; неоднозначное или чужое имя пропускается.
 * Компонент первичен: к частям составных компонентов (тег части даёт её
 * владельца) имя идёт, только если компонента с таким именем нет ни у кого —
 * резолвер авто-импорта знает компоненты и подставил бы его.
 */
export function tagSelection(tags: readonly string[], inputs: readonly GranumProviderInput[]): string[] {
  if (tags.length === 0)
    return []
  const components = new Map<string, ProviderNode[]>()
  const parts = new Map<string, ProviderNode[]>()
  const declare = (into: Map<string, ProviderNode[]>, name: string, node: ProviderNode): void => {
    into.set(name, [...(into.get(name) ?? []), node])
  }
  for (const input of inputs) {
    const node = toProviderNode(input)
    for (const component of node.components)
      declare(components, component.name, node)
    for (const part of node.subcomponents?.keys() ?? [])
      declare(parts, part, node)
  }
  const out: string[] = []
  for (const tag of tags) {
    const providers = components.get(tag) ?? parts.get(tag)
    const owner = providers?.length === 1 ? ownerOf(providers[0]!, tag) : undefined
    if (owner)
      out.push(`${owner.providerId}:${owner.name}`)
  }
  return out
}

/**
 * Импорты `<pkg>/components/<Name>` → ключи селекции: только те, чей
 * провайдер есть в графе и объявляет компонент; подпуть части даёт владельца.
 * Путь вида `~/components/AppHeader` — алиас приложения, а
 * `vuetify/components/VBtn` — чужой пакет: в селекцию они не идут и сборку не
 * роняют.
 */
export function importSelection(imports: readonly string[], providers: readonly ProviderNode[]): string[] {
  if (imports.length === 0)
    return []
  const byId = new Map(providers.map(provider => [provider.id, provider]))
  const out: string[] = []
  for (const key of imports) {
    const [providerId, name] = splitComponentKey(key)
    const provider = byId.get(providerId)
    const owner = provider ? ownerOf(provider, name) : undefined
    if (owner)
      out.push(`${providerId}:${owner.name}`)
  }
  return sortedUnique(out)
}

export async function prepareApp(config: GranumConfig, root: string): Promise<PreparedApp> {
  const engine = config.engine
  /*
   * Время трёх частей подготовки: манифесты и пересчёт классов, скан исходников
   * приложения, резолюция. Печатается в строке времени сборки — без этой
   * раскладки `prepare` на дизайн-системе был просто большим числом, по
   * которому не понять, чинить сканер, кэшировать пересчёт или не трогать
   * ничего.
   */
  const started = performance.now()
  const loaded = loadProviderInputs(config, root)
  const appScanStarted = performance.now()
  const appScan = scanAppSources(config.appSources, root, engine)
  const appScanMs = performance.now() - appScanStarted
  const warnings: PreparedWarning[] = []
  const providersStarted = performance.now()
  const { resolver: scanned, engineSources } = await scanProviderInputs(loaded, engine, warnings)
  // Сверка диалектов и отпечатков идёт ДО резолюции: она может заменить список
  // классов провайдера, а резолюция уже считает его данностью.
  const reconciled = await reconcileProviderEngines(scanned, engineSources, engine)
  const providersMs = performance.now() - providersStarted
  const inputs = reconciled.inputs

  let components: ComponentSelection | undefined
  if (config.components === 'imports') {
    if (!config.appSources)
      warnings.push({ kind: 'imports-without-app-sources' })
    components = [...importSelection(appScan.componentImports, inputs.map(toProviderNode)), ...tagSelection(appScan.componentTags, inputs)]
  }
  else {
    // Приложению без своих классов скан не нужен, но молчать нельзя: иначе
    // утилиты разметки пропадают без единого слова. Явный `dirs: []` — отказ.
    if (!config.appSources)
      warnings.push({ kind: 'app-sources-unset' })
    components = config.components
  }

  const themes = materializeAppThemes(config.themes, root)
  const resolution = resolveGranum({
    providers: inputs,
    ...(components !== undefined ? { components } : {}),
    ...(themes ? { themes } : {}),
    themeFiles: readThemeFiles(inputs),
  })
  for (const w of resolution.warnings) {
    if (w.kind === 'provider-without-manifest')
      warnings.push(w)
  }

  return {
    config,
    root,
    resolution,
    engine,
    timings: {
      providers: providersMs,
      appScan: appScanMs,
      resolve: performance.now() - started - providersMs - appScanMs,
    },
    appScan,
    selectionInput: components,
    engineContribution: reconciled.contribution,
    engineDecisions: reconciled.decisions,
    reextractLost: sortedUnique(resolution.selection.order.flatMap(key => reconciled.lostByComponent.get(key) ?? [])),
    warnings,
  }
}

/**
 * Селектор и токены файлов тем провайдеров — для блоков без своего селектора у
 * темы-файла и для `strictTokens`: ядро файлов не читает. Файл, который не
 * читается или не содержит плоских блоков токенов, фактов не даёт; ошибку чтения
 * назовёт эмиссия.
 */
function readThemeFiles(inputs: readonly GranumProviderInput[]): ThemeFilesInput {
  const out: Record<string, Record<string, ThemeFileFacts>> = {}
  for (const input of inputs) {
    const id = isLoadedManifest(input) ? input.manifest.id : input.id
    const files = isLoadedManifest(input) ? input.manifest.theme.themes : input.theme?.themes
    const baseUrl = input.baseUrl
    for (const [theme, ref] of Object.entries(files ?? {})) {
      let parsed
      try {
        parsed = parseCssTokenBlocksFromText(readCssSync(resolveProviderPath(ref, baseUrl)))
      }
      catch {
        continue
      }
      const [first, ...others] = parsed.blocks
      if (!first)
        continue
      const tokens = [...new Set(parsed.blocks.flatMap(block => Object.keys(block.tokens)))]
      // Разбор сливает блоки одного селектора, так что первый блок — вся тема
      // под её селектором; прочие блоки и пропущенные разбором — то, что
      // `extends` унаследовать не может.
      const partial = others.length > 0 || parsed.skipped.length > 0
      ;(out[id] ??= {})[theme] = { selector: first.selector, tokens, values: first.tokens, partial }
    }
  }
  return out
}
