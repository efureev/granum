/**
 * Подготовка приложения к эмиссии: конфиг → провайдеры
 * (манифесты через `exports`, объекты — материализованные) → селекция
 * (список или `'imports'`) → одна резолюция → движок с правилами провайдеров.
 * Node-only. Всё ниже (CSS, JS, токены, отчёт) читает только `PreparedApp`.
 */
import type { GranumConfig } from '../config'
import type { GranumComponentThemeTokens, GranumProvider, GranumProviderInput, GranumThemeData } from '../contract'
import type { ProviderNode } from '../core/providerNode'
import type { GranumResolution } from '../core/resolve'
import type { ComponentSelection } from '../core/resolveSelection'
import type { GranumModeDefinition, GranumModesInput, ThemePick } from '../core/resolveThemes'
import type { EngineInput, GranumEngine } from '../engine/types'
import type { AppSourcesScan } from './appSources'
import type { ProviderEngineDecision } from './dialects'
import { resolve as resolvePath } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isLoadedManifest } from '../contract/manifest'
import { sortedUnique } from '../core/dedupe'
import { DuplicateProviderIdError, ThemeDataError, ThemeResolutionError, TokenRefError } from '../core/errors'
import { ownerOf, ownsThemes, toProviderNode, uniqueDeclarers } from '../core/providerNode'
import { splitComponentKey } from '../core/registry'
import { resolveGranum } from '../core/resolve'
import { APP_THEME_SOURCE, planThemes } from '../core/resolveThemes'
import { checkThemeData } from '../core/themeData'
import { scanAppSources } from './appSources'
import { tokenSetFromCssSync } from './cssTokens'
import { reconcileProviderEngines } from './dialects'
import { resolveProviderPath } from './inlinedCss'
import { loadPackageManifest } from './manifest'
import { collectProviderInstances, scanObjectProvider } from './scanProvider'
import { readJsonFile, readObjectComponentThemes } from './themeFiles'

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
 * Провайдер по имени пакета — манифест через `exports`; объект — как есть.
 *
 * Объектные доноры из `dependencies` подключаются наравне с перечисленными:
 * каждый инстанс подаётся один раз, а ссылки на него в `dependencies`
 * сводятся к `id`. Иначе скан по `dist` давал бы донору новый объект,
 * `dependencies` соседа держали бы старый, и проверка идентичности в графе
 * видела бы два инстанса с одним `id` там, где он один.
 * Строковая зависимость задаёт порядок так же, как объектная, —
 * так же, как в синтетическом манифесте медленного пути.
 *
 * Строковая зависимость, которой нет в `providers`, подгружается как пакет с
 * манифестом от каталога зависимого провайдера (A-31): при строгой раскладке
 * `node_modules` от корня приложения транзитивный пакет не виден. Ids таких
 * доноров попадают в `donors` — их компоненты селекция `'all'` не выбирает.
 */
export function loadProviderInputs(config: Pick<GranumConfig, 'providers'>, root: string, donors?: Set<string>): GranumProviderInput[] {
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
    const dependencies = provider.dependencies ?? []
    out.push(dependencies.some(dep => typeof dep !== 'string')
      ? { ...provider, dependencies: dependencies.map(dep => (typeof dep === 'string' ? dep : dep.id)) }
      : provider)
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

  const ids = new Set(out.map(providerIdOf))
  const unresolved: { readonly id: string, readonly from: string }[] = []
  for (let i = 0; i < out.length; i++) {
    const input = out[i]!
    const from = providerDirOf(input) ?? root
    for (const dep of stringDependencies(input)) {
      if (ids.has(dep))
        continue
      let donor: GranumProviderInput
      try {
        donor = loadPackageManifest(dep, from)
      }
      catch {
        unresolved.push({ id: dep, from: providerIdOf(input) })
        continue
      }
      ids.add(dep)
      donors?.add(dep)
      out.push(donor)
    }
  }
  if (unresolved.length > 0)
    assertThemeOwnerPresent(out, unresolved)
  return out
}

function providerIdOf(input: GranumProviderInput): string {
  return isLoadedManifest(input) ? input.manifest.id : input.id
}

function stringDependencies(input: GranumProviderInput): readonly string[] {
  return isLoadedManifest(input)
    ? input.manifest.dependencies
    : (input.dependencies ?? []).filter((dep): dep is string => typeof dep === 'string')
}

/** Каталог, от которого разрешаются зависимости провайдера: директория манифеста или `baseUrl` объекта. */
function providerDirOf(input: GranumProviderInput): string | undefined {
  const base = input.baseUrl
  return base?.startsWith('file:') ? fileURLToPath(base) : undefined
}

/**
 * Зависимость не разрешилась, а провайдеры с токенами компонентов по темам
 * остались без владельца каталога: тема не соберётся, и это точнее, чем «нет
 * провайдера с таким id» (A-31). Без тем — прежняя ошибка графа.
 */
function assertThemeOwnerPresent(inputs: readonly GranumProviderInput[], unresolved: readonly { readonly id: string, readonly from: string }[]): void {
  const nodes = inputs.map(toProviderNode)
  if (nodes.some(ownsThemes))
    return
  const themed = nodes.filter(node => node.components.some(component => Object.keys(component.themeTokens).length > 0 || component.themesDir !== undefined))
  const missing = unresolved.filter(dep => themed.some(node => node.id === dep.from))
  if (missing.length === 0)
    return
  throw new ThemeResolutionError(
    'theme-owner-missing',
    `${missing.map(dep => `'${dep.from}' depends on '${dep.id}'`).join(', ')}, which cannot be resolved from the dependent package, `
    + `and no provider in the graph declares a theme catalog — the themes of its components have no owner. Install '${missing[0]!.id}' or add it to 'providers'.`,
    missing[0]!.id,
  )
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
 * `modes.define[*].tokensRef` → литеральные `tokens`: относительный путь
 * считается от корня приложения; литеральные `tokens` важнее файла.
 */
export function materializeAppModes(modes: GranumModesInput | undefined, root: string): GranumModesInput | undefined {
  if (!modes?.define)
    return modes
  let changed = false
  const define: Record<string, GranumModeDefinition> = {}
  for (const [name, definition] of Object.entries(modes.define)) {
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
        ...(ref.strict !== undefined ? { strict: ref.strict } : {}),
      })
    }
    catch (cause) {
      throw new TokenRefError(APP_THEME_SOURCE, name, undefined, ref.url, { cause })
    }
    const { tokensRef: _dropped, ...rest } = definition
    define[name] = { ...rest, tokens: { ...parsed.tokens, ...definition.tokens } }
  }
  return changed ? { ...modes, define } : modes
}

/**
 * Данные тем, которые собирает сборка: активная и превью из каталога (T-6).
 * Остальные темы каталога не читаются.
 */
export function readPlannedThemeData(picks: readonly (ThemePick | undefined)[], providers: readonly ProviderNode[]): Record<string, Record<string, GranumThemeData>> {
  const out: Record<string, Record<string, GranumThemeData>> = {}
  for (const pick of picks) {
    if (pick?.kind !== 'catalog' || out[pick.providerId]?.[pick.id])
      continue
    const provider = providers.find(p => p.id === pick.providerId)!
    const url = resolveProviderPath(pick.data, provider.baseUrl)
    const file = url.startsWith('file:') ? fileURLToPath(url) : url
    let raw: unknown
    try {
      raw = readJsonFile(file)
    }
    catch (cause) {
      throw new ThemeDataError(pick.providerId, pick.id, file, (cause as Error).message, { cause })
    }
    const issue = checkThemeData(raw)
    if (issue)
      throw new ThemeDataError(pick.providerId, pick.id, file, `${issue.path ? `'${issue.path}': ` : ''}${issue.details}`)
    const byTheme = out[pick.providerId] ??= {}
    byTheme[pick.id] = raw as GranumThemeData
  }
  return out
}

/** Токены `themesDir` объектных провайдеров, которых медленный путь не превратил в манифест. */
function readComponentThemes(inputs: readonly GranumProviderInput[]): Record<string, Record<string, Record<string, GranumComponentThemeTokens>>> {
  const out: Record<string, Record<string, Record<string, GranumComponentThemeTokens>>> = {}
  for (const input of inputs) {
    if (isLoadedManifest(input) || !input.components.some(component => component.themesDir !== undefined))
      continue
    out[input.id] = readObjectComponentThemes(input, providerDirOf(input))
  }
  return out
}

/**
 * Теги разметки → ключи селекции по тому же правилу имён, что у резолвера
 * авто-импорта (`uniqueDeclarers`): имя у ровно одного провайдера, компонент
 * первичен; тег части даёт её владельца. Неоднозначное или чужое имя
 * пропускается.
 */
export function tagSelection(tags: readonly string[], inputs: readonly GranumProviderInput[]): string[] {
  if (tags.length === 0)
    return []
  const declarers = uniqueDeclarers(inputs.map(toProviderNode))
  const out: string[] = []
  for (const tag of tags) {
    const provider = declarers.get(tag)
    const owner = provider ? ownerOf(provider, tag) : undefined
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
  const donors = new Set<string>()
  const loaded = loadProviderInputs(config, root, donors)
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
    // Донор, подгруженный по зависимости, компонентов не выбирает (C-4): `'all'` — это провайдеры приложения.
    if ((components === undefined || components === 'all') && donors.size > 0)
      components = inputs.map(providerIdOf).filter(id => !donors.has(id)).map(provider => ({ provider, names: 'all' as const }))
  }

  const modes = materializeAppModes(config.modes, root)
  const nodes = inputs.map(toProviderNode)
  const plan = planThemes(nodes, {
    ...(config.theme !== undefined ? { theme: config.theme } : {}),
    ...(config.previews !== undefined ? { previews: config.previews } : {}),
  })
  const resolution = resolveGranum({
    providers: inputs,
    ...(components !== undefined ? { components } : {}),
    ...(config.theme !== undefined ? { theme: config.theme } : {}),
    ...(config.previews !== undefined ? { previews: config.previews } : {}),
    ...(modes ? { modes } : {}),
    themeData: readPlannedThemeData([plan.active, ...plan.previews], nodes),
    componentThemes: readComponentThemes(inputs),
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
