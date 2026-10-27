/**
 * Подготовка приложения к эмиссии: конфиг → провайдеры
 * (манифесты через `exports`, объекты — материализованные) → селекция
 * (список или `'imports'`) → одна резолюция → движок с правилами провайдеров.
 * Node-only. Всё ниже (CSS, JS, токены, отчёт) читает только `PreparedApp`.
 */
import type { GranumConfig } from '../config'
import type { GranumComponentThemeTokens, GranumProvider, GranumProviderInput, GranumThemeData, GranumTokenRef } from '../contract'
import type { ProviderNode, ThemeCatalogNode } from '../core/providerNode'
import type { GranumResolution } from '../core/resolve'
import type { ComponentSelection } from '../core/resolveSelection'
import type { GranumAppTheme, GranumModeDefinition, GranumThemeConfig, GranumThemeModes, ThemePick, ThemePlan } from '../core/resolveThemes'
import type { TokenNature } from '../core/themeData'
import type { EngineInput, GranumEngine } from '../engine/types'
import type { AppSourcesScan } from './appSources'
import type { ProviderEngineDecision } from './dialects'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isLoadedManifest } from '../contract/manifest'
import { sortedUnique } from '../core/dedupe'
import { DuplicateProviderIdError, ThemeDataError, ThemeResolutionError, TokenParseError, TokenRefError } from '../core/errors'
import { ownerOf, ownsThemes, toProviderNode, uniqueDeclarers } from '../core/providerNode'
import { splitComponentKey } from '../core/registry'
import { resolveGranum } from '../core/resolve'
import { APP_THEME_SOURCE, normalizeThemeEntry, planThemes } from '../core/resolveThemes'
import { checkThemeData, unflattenThemeComponents } from '../core/themeData'
import { scanAppSources } from './appSources'
import { parseCssTokenBlocks, tokenSetFromCssSync } from './cssTokens'
import { reconcileProviderEngines } from './dialects'
import { resolveProviderPath } from './inlinedCss'
import { loadPackageManifest } from './manifest'
import { collectProviderInstances, scanObjectProvider } from './scanProvider'
import { parseRegistry, readJsonFile, readObjectComponentThemes, themeSourceUnbuilt } from './themeFiles'

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
 * манифестом от каталога зависимого провайдера: при строгой раскладке
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
 * провайдера с таким id». Без тем — прежняя ошибка графа.
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
 * Токены CSS-файла приложения. Относительный путь считается от корня
 * приложения; `scope` — режим или область для сообщения об ошибке.
 */
function readAppTokenRef(input: GranumTokenRef | string, root: string, scope: string): Readonly<Record<string, string>> {
  const ref = typeof input === 'string' ? { url: input } : input
  const url = /^[a-z]+:/i.test(ref.url) ? ref.url : pathToFileURL(resolvePath(root, ref.url)).href
  try {
    // Файл — один плоский блок: без `selector` второй блок молча пропал бы, а
    // первый попавшийся выдавался бы за весь файл.
    if (ref.selector === undefined && ref.strict !== false) {
      const blocks = parseCssTokenBlocks(url)
      if (blocks.length > 1) {
        throw new TokenParseError(
          `${ref.url} has ${blocks.length} token blocks (${blocks.map(b => JSON.stringify(b.selector)).join(', ')}); a token file holds one flat block — or name the block with 'selector'.`,
          ref.url,
          'multiple-blocks',
          blocks.map(b => b.selector),
        )
      }
    }
    return tokenSetFromCssSync(url, {
      ...(ref.selector !== undefined ? { selector: ref.selector } : {}),
      ...(ref.strict !== undefined ? { strict: ref.strict } : {}),
    }).tokens
  }
  catch (cause) {
    throw new TokenRefError(APP_THEME_SOURCE, scope, undefined, ref.url, { cause })
  }
}

/**
 * `modes.define[*].tokensRef` и `modes.tokenOverridesRef` → литеральные
 * `tokens` и `tokenOverrides`: литеральные значения важнее файла.
 */
export function materializeAppModes(modes: GranumThemeModes | undefined, root: string): GranumThemeModes | undefined {
  if (!modes?.define && !modes?.tokenOverridesRef)
    return modes
  let changed = false
  let define = modes.define
  if (modes.define) {
    const out: Record<string, GranumModeDefinition> = {}
    for (const [name, definition] of Object.entries(modes.define)) {
      if (!definition.tokensRef) {
        out[name] = definition
        continue
      }
      changed = true
      const { tokensRef, ...rest } = definition
      out[name] = { ...rest, tokens: { ...readAppTokenRef(tokensRef, root, name), ...definition.tokens } }
    }
    define = out
  }
  if (!modes.tokenOverridesRef)
    return changed && define ? { ...modes, define } : modes
  const { tokenOverridesRef, ...rest } = modes
  const tokenOverrides: Record<string, Readonly<Record<string, string>>> = { ...modes.tokenOverrides }
  for (const [scope, ref] of Object.entries(tokenOverridesRef))
    tokenOverrides[scope] = { ...readAppTokenRef(ref, root, scope), ...modes.tokenOverrides?.[scope] }
  return { ...rest, ...(define ? { define } : {}), tokenOverrides }
}

/** Записи `themes` с материализованными `tokensRef` режимов; без файлов — как есть. */
export function materializeThemes(themes: readonly GranumThemeConfig[] | undefined, root: string): readonly GranumThemeConfig[] | undefined {
  if (!themes)
    return themes
  let changed = false
  const out = themes.map((config) => {
    const entry = normalizeThemeEntry(config)
    const modes = materializeAppModes(entry.modes, root)
    if (modes === entry.modes)
      return config
    changed = true
    return { theme: entry.theme, default: entry.default, modes: modes! }
  })
  return changed ? out : themes
}

/**
 * Темы каталога, чьи данные нужны сборке: темы из `themes` и родители
 * тем-объектов по `extends` — их данные дополняют объект (A-22). Остальные
 * темы каталога не читаются.
 */
export function plannedThemeDataPicks(plan: ThemePlan): ThemePick[] {
  const picks: ThemePick[] = []
  const parentsOf = (theme: GranumAppTheme, visiting: readonly GranumAppTheme[] = []): void => {
    const base = theme.extends
    // Цикл назовёт резолвер (`theme-extends-cycle`); здесь только не уйти в него.
    if (typeof base === 'object') {
      if (!visiting.includes(base))
        parentsOf(base, [...visiting, theme])
      return
    }
    const entry = base === undefined ? undefined : plan.owner?.theme.catalog[base]
    if (entry)
      picks.push({ kind: 'catalog', providerId: plan.owner!.id, id: base!, data: entry.data })
  }
  for (const planned of plan.themes) {
    picks.push(planned.pick)
    if (planned.pick.kind === 'app')
      parentsOf(planned.pick.theme)
  }
  return picks
}

/** Реестр владельца каталога для резолюции; не читается — пусто: об этом скажет `doctor` (`registry-invalid`). */
export function readOwnerRegistry(plan: ThemePlan): Record<string, TokenNature> {
  const owner = plan.owner
  if (owner?.theme.registry === undefined)
    return {}
  const url = resolveProviderPath(owner.theme.registry, owner.baseUrl)
  const file = url.startsWith('file:') ? fileURLToPath(url) : url
  try {
    return parseRegistry(owner.id, file, readFileSync(file, 'utf8'))
  }
  catch {
    return {}
  }
}

/**
 * Запись каталога `{ source }` просканированного провайдера: в синтетический
 * манифест она не попадает — раскрыть исходник некому, — а в план тем входит,
 * чтобы выбор этой темы дал `theme-source-unbuilt`, а не `unknown-theme` (C-43).
 */
function withUnbuiltSources(nodes: readonly ProviderNode[], loaded: readonly GranumProviderInput[]): ProviderNode[] {
  const sources = new Map<string, Record<string, ThemeCatalogNode>>()
  for (const input of loaded) {
    if (isLoadedManifest(input))
      continue
    const entries = Object.entries(input.theme?.catalog ?? {}).flatMap(([id, entry]): [string, ThemeCatalogNode][] =>
      'source' in entry ? [[id, { title: id, data: '', source: entry.source }]] : [])
    if (entries.length > 0)
      sources.set(input.id, Object.fromEntries(entries))
  }
  return nodes.map((node) => {
    const extra = sources.get(node.id)
    return extra !== undefined && node.form === 'manifest' ? { ...node, theme: { ...node.theme, catalog: { ...extra, ...node.theme.catalog } } } : node
  })
}

/**
 * Данные тем по плану ({@link plannedThemeDataPicks}). Данные `dist` несут
 * значения раздела ещё и слитыми (C-44): копии с тем же значением на том же
 * месте разводятся по месту, иная копия — коллизия.
 */
export function readPlannedThemeData(picks: readonly (ThemePick | undefined)[], providers: readonly ProviderNode[]): Record<string, Record<string, GranumThemeData>> {
  const out: Record<string, Record<string, GranumThemeData>> = {}
  for (const pick of picks) {
    if (pick?.kind !== 'catalog' || out[pick.providerId]?.[pick.id])
      continue
    const provider = providers.find(p => p.id === pick.providerId)!
    const source = provider.theme.catalog[pick.id]?.source
    if (source !== undefined)
      throw themeSourceUnbuilt(provider.id, pick.id, source)
    const url = resolveProviderPath(pick.data, provider.baseUrl)
    const file = url.startsWith('file:') ? fileURLToPath(url) : url
    let raw: unknown
    try {
      raw = readJsonFile(file)
    }
    catch (cause) {
      throw new ThemeDataError(pick.providerId, pick.id, file, (cause as Error).message, { cause })
    }
    const issue = checkThemeData(raw, { flattened: true })
    if (issue)
      throw new ThemeDataError(pick.providerId, pick.id, file, `${issue.path ? `'${issue.path}': ` : ''}${issue.details}`, { reason: issue.reason })
    const byTheme = out[pick.providerId] ??= {}
    byTheme[pick.id] = unflattenThemeComponents(raw as GranumThemeData)
  }
  return out
}

/** Токены `themesDir` объектных провайдеров, которых медленный путь не превратил в манифест. */
export function readComponentThemes(inputs: readonly GranumProviderInput[]): Record<string, Record<string, Record<string, GranumComponentThemeTokens>>> {
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
    // Донор, подгруженный по зависимости, компонентов не выбирает: `'all'` — это провайдеры приложения.
    if ((components === undefined || components === 'all') && donors.size > 0)
      components = inputs.map(providerIdOf).filter(id => !donors.has(id)).map(provider => ({ provider, names: 'all' as const }))
  }

  const themes = materializeThemes(config.themes, root)
  const nodes = withUnbuiltSources(inputs.map(toProviderNode), loaded)
  const plan = planThemes(nodes, themes !== undefined ? { themes } : {})
  const resolution = resolveGranum({
    providers: inputs,
    ...(components !== undefined ? { components } : {}),
    ...(themes !== undefined ? { themes } : {}),
    ...(config.activation !== undefined ? { activation: config.activation } : {}),
    themeData: readPlannedThemeData(plannedThemeDataPicks(plan), nodes),
    componentThemes: readComponentThemes(inputs),
    themeRegistry: readOwnerRegistry(plan),
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
