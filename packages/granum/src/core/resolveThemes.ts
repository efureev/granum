/**
 * Темы сборки и их режимы: владелец каталога, список тем с основной,
 * набор режимов каждой темы с `define`, общая активация. Значения токенов
 * считает `tokenLayers` — здесь только то, ЧТО собирается.
 */
import type { GranumComponentThemeTokens, GranumModeFallback, GranumThemeData, GranumTokenRef } from '../contract'
import type { ComponentNode, ProviderNode } from './providerNode'
import type { ThemePatch, TokenNature } from './themeData'
import { themePairValue } from '../runtime/manifest'
import { DEFAULT_ACTIVATION_ATTRIBUTE, DEFAULT_ACTIVATION_VALUE } from './activation'
import { ThemeDataError, ThemeResolutionError } from './errors'
import { ownsThemes } from './providerNode'
import { satisfies } from './semver'
import { checkThemeData, DEFAULT_MODE, flattenThemeComponents, mergeThemePatch, modeChain, themeModeOrder, unflattenThemeComponents } from './themeData'

/** Идентификатор источника для вкладов самого приложения. */
export const APP_THEME_SOURCE = '(app)'

interface GranumAppThemeSources {
  /** Файлы, из которых собран объект: их правка в dev перезагружает конфиг. */
  readonly sources?: readonly string[]
}

/** Тема-объект без `extends`: полные данные. */
export interface GranumAppThemeData extends GranumThemeData, GranumAppThemeSources {
  readonly extends?: undefined
}

/**
 * Тема-объект с `extends` — темой каталога по id или другим объектом: только
 * отличия, `id` и `title` свои. Резолвер сливает их с родителем до проверок (A-22).
 */
export interface GranumAppThemePatch extends ThemePatch, GranumAppThemeSources {
  readonly id: string
  readonly title: string
  readonly extends: string | GranumAppTheme
}

/** Тема-объект приложения: полные данные или отличия от родителя. */
export type GranumAppTheme = GranumAppThemeData | GranumAppThemePatch

/** Режим приложения поверх режимов темы. */
export interface GranumModeDefinition {
  /** Режим темы или другой `define`, чьи итоговые значения берутся за основу. */
  readonly extends: string
  /** Собственные токены, БЕЗ `--`. */
  readonly tokens?: Readonly<Record<string, string>>
  /** Значения из CSS; материализуется node-слоем до резолюции. Литеральные `tokens` важнее. */
  readonly tokensRef?: GranumTokenRef | string
  readonly title?: string
  readonly colorScheme?: 'light' | 'dark'
  /**
   * Фолбэки `@supports` режима — ставятся после унаследованных от базы и
   * перекрывают их по токену. Без них режим берёт фолбэки базы как есть, а
   * они посчитаны от её значений, а не от своих.
   */
  readonly fallbacks?: readonly GranumModeFallback[]
}

/** Режимы одной темы сборки. */
export interface GranumThemeModes {
  /** `undefined` — режим по умолчанию темы плюс `define`; `[]` — режимов нет. */
  readonly names?: readonly string[]
  readonly define?: Readonly<Record<string, GranumModeDefinition>>
  /** `root` — режимонезависимые токены, остальные ключи — режимы. Ключи токенов без `--`. */
  readonly tokenOverrides?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Override токена, которого нет ни в данных темы, ни в токенах компонентов, отбрасывается. */
  readonly strictTokens?: boolean
}

export type GranumThemeChoice = string | GranumAppTheme

/** Запись `themes`: тема, отметка основной и её режимы. */
export interface GranumThemeEntry {
  readonly theme: GranumThemeChoice
  /** Основная тема сборки: в общем листе и под `:root`. Ровно одна на сборку. */
  readonly default?: boolean
  /** Имена режимов или их полное описание. */
  readonly modes?: readonly string[] | GranumThemeModes
}

/** Запись `themes` в краткой форме — сама тема — или полной. */
export type GranumThemeConfig = GranumThemeChoice | GranumThemeEntry

/** Как корень выбирает пару — общее на все темы сборки: корень у документа один. */
export interface GranumActivation {
  /** Атрибут на корне. По умолчанию `data-theme`. */
  readonly attribute?: string
  /** Шаблон значения с `{theme}` и `{mode}`. По умолчанию `{theme}-{mode}`. */
  readonly value?: string
  /** `media` — тёмный режим основной темы по `prefers-color-scheme`, пока атрибут не выставлен. */
  readonly system?: 'none' | 'media'
}

/** Темы и активация — часть конфига, которую понимает ядро. */
export interface ResolveThemesInput {
  readonly themes?: readonly GranumThemeConfig[]
  readonly activation?: GranumActivation
}

/** Данные тем каталога, прочитанные node-слоем: провайдер → id темы → данные. */
export type ThemeDataInput = Readonly<Record<string, Readonly<Record<string, GranumThemeData>>>>

/** Токены компонентов объектной формы из `themesDir`: провайдер → компонент → тема → токены. */
export type ComponentThemesInput = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, GranumComponentThemeTokens>>>>>>

export type ThemeSource = 'app' | 'provider' | 'default'
export type ModesSource = 'explicit' | 'theme'

/** Исход сверки `targets` темы с пакетом графа (A-38). */
export interface ThemeTargetCheck {
  readonly providerId: string
  readonly range: string
  /** Версия пакета в графе; нет — пакета нет в графе или его версия неизвестна. */
  readonly version?: string
  readonly status: 'match' | 'mismatch' | 'absent' | 'unknown-version'
}

export interface ResolvedTheme {
  readonly id: string
  readonly title: string
  /** Владелец каталога; у темы-объекта приложения — {@link APP_THEME_SOURCE}. */
  readonly providerId: string
  /** Полные данные; значения раздела `components` слиты в `root`/`modes`, раздел остаётся индексом. */
  readonly data: GranumThemeData
  /**
   * У темы-объекта с `extends` — полные данные родителя: унаследованное идёт слоем
   * данных его темы, а слоем приложения — только собственные отличия (A-22, T-7).
   */
  readonly inherited?: { readonly id: string, readonly data: GranumThemeData }
  /** Цепочка тем для токенов компонентов: сама тема, затем предки по каталогу. */
  readonly chain: readonly string[]
  /** Сверка `targets` с пакетами графа; у темы без `targets` пусто. */
  readonly targets: readonly ThemeTargetCheck[]
}

export interface ResolvedMode {
  readonly name: string
  readonly title?: string
  readonly colorScheme: 'light' | 'dark'
  /** Значение атрибута активации — пара. */
  readonly value: string
  readonly origin: 'theme' | 'define'
  /** База `define`; у режима темы — `extends` из данных. */
  readonly extends?: string
}

/** Тема сборки с её режимами. */
export interface ResolvedBuildTheme {
  readonly theme: ResolvedTheme
  /** Основная: под `:root` и в общем листе. */
  readonly isDefault: boolean
  /** Режимы в порядке эмиссии: режим по умолчанию первым. */
  readonly modes: readonly ResolvedMode[]
  /** Все режимы `define` темы, включая не вошедшие в набор, — база раньше наследника. */
  readonly definitions: readonly ResolvedMode[]
  readonly modesSource: ModesSource
  readonly defaultMode: string
  /** `define`, `tokenOverrides` и `strictTokens` записи — вход слоёв токенов. */
  readonly input: GranumThemeModes
}

export type ResolvedThemeWarning
  = | { readonly kind: 'component-theme-unknown', readonly providerId: string, readonly component: string, readonly theme: string }
    | { readonly kind: 'mode-extends-unresolved', readonly theme: string, readonly mode: string, readonly base: string }
    | { readonly kind: 'mode-extends-cycle', readonly theme: string, readonly chain: readonly string[] }
    | { readonly kind: 'theme-target-mismatch', readonly theme: string, readonly providerId: string, readonly range: string, readonly version: string }
    | { readonly kind: 'theme-component-unknown', readonly theme: string, readonly providerId: string, readonly component: string }
    /** Токен раздела, которого компонент не требует извне, или хук в данных темы (A-37). */
    | { readonly kind: 'theme-token-foreign', readonly theme: string, readonly providerId: string, readonly component: string, readonly token: string, readonly place: 'section' | 'hook' }

export interface ResolvedThemes {
  /** Темы сборки в порядке конфига; пусто — тем нет, слой `themes` пуст. */
  readonly themes: readonly ResolvedBuildTheme[]
  /** Основная тема; `undefined` — тем нет. */
  readonly default: ResolvedBuildTheme | undefined
  /** Откуда взята основная тема. */
  readonly themeSource: ThemeSource | undefined
  /** Владелец каталога в графе. */
  readonly owner: string | undefined
  readonly activation: { readonly attribute: string, readonly value: string }
  readonly system: 'none' | 'media'
  readonly warnings: readonly ResolvedThemeWarning[]
}

/** Тема, выбранная до чтения данных: id каталога или объект приложения. */
export type ThemePick
  = | { readonly kind: 'catalog', readonly providerId: string, readonly id: string, readonly data: string }
    | { readonly kind: 'app', readonly theme: GranumAppTheme }

/** Запись `themes` после разбора: тема, основная ли, режимы. */
export interface PlannedTheme {
  readonly pick: ThemePick
  readonly isDefault: boolean
  readonly modes: GranumThemeModes
}

export interface ThemePlan {
  readonly owner: ProviderNode | undefined
  /** Темы сборки в порядке конфига. */
  readonly themes: readonly PlannedTheme[]
  /** Откуда взята основная тема. */
  readonly source: ThemeSource | undefined
}

/** Темы сборки, кроме основной, — каждая своим листом. */
export function additionalThemes(themes: ResolvedThemes): readonly ResolvedBuildTheme[] {
  return themes.themes.filter(entry => !entry.isDefault)
}

/** Владелец каталога: 0 или 1 в графе. */
export function findThemeOwner(providers: readonly ProviderNode[]): ProviderNode | undefined {
  const owners = providers.filter(ownsThemes)
  if (owners.length > 1) {
    throw new ThemeResolutionError(
      'multiple-theme-owners',
      `${owners.map(o => `'${o.id}'`).join(' and ')} both declare a theme catalog; granum 3 supports one catalog owner per application. `
      + `Pass the extra themes as application theme objects in 'themes' instead.`,
      undefined,
      owners.map(o => o.id),
    )
  }
  return owners[0]
}

/** `providerId:id` → провайдер и id; разбор по последнему двоеточию. */
export function splitThemeKey(key: string): { providerId?: string, id: string } {
  const at = key.lastIndexOf(':')
  return at > 0 ? { providerId: key.slice(0, at), id: key.slice(at + 1) } : { id: key }
}

function pickCatalogTheme(owner: ProviderNode | undefined, key: string): ThemePick {
  const { providerId, id } = splitThemeKey(key)
  const available = owner ? Object.keys(owner.theme.catalog) : []
  const entry = owner && (providerId === undefined || providerId === owner.id) ? owner.theme.catalog[id] : undefined
  if (!owner || !entry) {
    throw new ThemeResolutionError(
      'unknown-theme',
      owner
        ? `theme '${key}' is not in the catalog of '${owner.id}'. Available: ${available.join(', ') || '—'}.`
        : `theme '${key}' is requested, but no provider in the graph declares a theme catalog.`,
      key,
      available,
    )
  }
  return { kind: 'catalog', providerId: owner.id, id, data: entry.data }
}

function isEntry(config: GranumThemeConfig): config is GranumThemeEntry {
  return typeof config === 'object' && config !== null && 'theme' in config
}

/** Запись `themes` в полной форме: тема, отметка и режимы объектом. */
export function normalizeThemeEntry(config: GranumThemeConfig): { readonly theme: GranumThemeChoice, readonly default: boolean, readonly modes: GranumThemeModes } {
  if (!isEntry(config))
    return { theme: config, default: false, modes: {} }
  const modes: GranumThemeModes = config.modes === undefined ? {} : Array.isArray(config.modes) ? { names: config.modes } : config.modes as GranumThemeModes
  return { theme: config.theme, default: config.default === true, modes }
}

/** Id темы записи до чтения данных — для сообщений. */
function choiceId(choice: GranumThemeChoice): string {
  return typeof choice === 'string' ? splitThemeKey(choice).id : choice.id
}

/**
 * Индекс основной темы: единственная запись — она, из нескольких — ровно одна с
 * `default: true`. Конфиг проверяет то же формой; здесь — для программного входа.
 */
export function defaultThemeIndex(entries: readonly { readonly theme: GranumThemeChoice, readonly default: boolean }[]): number {
  if (entries.length === 1)
    return 0
  const marked = entries.flatMap((entry, i) => (entry.default ? [i] : []))
  if (marked.length !== 1) {
    const ids = entries.map(entry => choiceId(entry.theme))
    throw new ThemeResolutionError(
      'default-theme',
      marked.length === 0
        ? `'themes' lists ${entries.length} themes (${ids.join(', ')}) and none is marked 'default: true'; mark the one that goes under ':root'.`
        : `'themes' marks ${marked.length} themes as default (${marked.map(i => ids[i]).join(', ')}); exactly one goes under ':root'.`,
      undefined,
      ids,
    )
  }
  return marked[0]!
}

/**
 * Что собирается: владелец и темы сборки с основной — до чтения данных.
 * Node-слой читает по этому плану только нужные файлы.
 */
export function planThemes(providers: readonly ProviderNode[], input: ResolveThemesInput = {}): ThemePlan {
  const owner = findThemeOwner(providers)
  if (input.themes === undefined) {
    if (!owner)
      return { owner, themes: [], source: undefined }
    const ids = Object.keys(owner.theme.catalog)
    const id = owner.theme.defaultTheme ?? (ids.length === 1 ? ids[0] : undefined)
    if (id === undefined) {
      throw new ThemeResolutionError(
        'unknown-theme',
        `'${owner.id}' declares ${ids.length} themes and no 'defaultTheme'; list the build themes in 'themes' of granum.config. Available: ${ids.join(', ')}.`,
        undefined,
        ids,
      )
    }
    return { owner, themes: [{ pick: pickCatalogTheme(owner, id), isDefault: true, modes: {} }], source: 'default' }
  }
  if (input.themes.length === 0)
    throw new ThemeResolutionError('default-theme', `'themes' is empty; omit it to build the default theme of the catalog.`)

  const entries = input.themes.map(normalizeThemeEntry)
  const defaultIndex = defaultThemeIndex(entries)
  const seen = new Set<string>()
  const themes = entries.map((entry, i): PlannedTheme => {
    const pick: ThemePick = typeof entry.theme === 'string' ? pickCatalogTheme(owner, entry.theme) : { kind: 'app', theme: entry.theme }
    const id = pick.kind === 'catalog' ? pick.id : pick.theme.id
    if (seen.has(id))
      throw new ThemeResolutionError('duplicate-theme', `theme '${id}' is listed twice in 'themes'; both entries would activate with the same pairs.`, id)
    seen.add(id)
    return { pick, isDefault: i === defaultIndex, modes: entry.modes }
  })
  return { owner, themes, source: themes[defaultIndex]!.pick.kind === 'app' ? 'app' : 'provider' }
}

function themeChain(owner: ProviderNode | undefined, id: string | undefined): string[] {
  const chain: string[] = []
  for (let current = id; current !== undefined && !chain.includes(current); current = owner?.theme.catalog[current]?.extends)
    chain.push(current)
  return chain
}

function catalogData(owner: ProviderNode, id: string, themeData: ThemeDataInput): GranumThemeData {
  const data = themeData[owner.id]?.[id]
  if (!data) {
    throw new ThemeResolutionError(
      'theme-data-missing',
      `the data of theme '${id}' of '${owner.id}' was not supplied to the resolver (expected at '${owner.theme.catalog[id]?.data}').`,
      id,
    )
  }
  return data
}

function appThemeIssue(id: string, data: unknown): void {
  const issue = checkThemeData(data)
  if (issue)
    throw new ThemeDataError(APP_THEME_SOURCE, id, issue.path ? `themes: ${issue.path}` : 'themes', issue.details, { reason: issue.reason })
}

/**
 * Тема-объект: с `extends` — родитель плюс отличия по C-27, проверенные уже
 * целиком; цепочка — сама тема и цепочка родителя по каталогу. Без `extends`
 * данные проверяются и здесь: резолвер зовут и без проверки конфига.
 */
function appThemeData(
  theme: GranumAppTheme,
  owner: ProviderNode | undefined,
  themeData: ThemeDataInput,
  visiting: readonly GranumAppTheme[] = [],
): { readonly data: GranumThemeData, readonly chain: readonly string[], readonly inherited?: { readonly id: string, readonly data: GranumThemeData } } {
  if (visiting.includes(theme))
    throw new ThemeResolutionError('theme-extends-cycle', `theme objects extend each other in a cycle: ${[...visiting, theme].map(t => t.id).join(' -> ')}.`, theme.id)
  if (theme.extends === undefined) {
    const { extends: _base, sources: _sources, ...own } = theme
    appThemeIssue(own.id, own)
    return { data: own, chain: [own.id] }
  }
  const { extends: base, sources: _sources, ...own } = theme
  let parent: GranumThemeData
  let parentChain: readonly string[]
  if (typeof base === 'string') {
    // Неизвестная база молча не дала бы ни значений, ни токенов компонентов своей цепочки.
    if (!owner || owner.theme.catalog[base] === undefined) {
      const available = owner ? Object.keys(owner.theme.catalog) : []
      throw new ThemeResolutionError(
        'unknown-theme',
        owner
          ? `theme object '${own.id}' extends '${base}', which is not in the catalog of '${owner.id}'. Available: ${available.join(', ') || '—'}.`
          : `theme object '${own.id}' extends '${base}', but no provider in the graph declares a theme catalog.`,
        base,
        available,
      )
    }
    parent = catalogData(owner, base, themeData)
    parentChain = themeChain(owner, base)
  }
  else {
    const resolved = appThemeData(base, owner, themeData, [...visiting, theme])
    parent = resolved.data
    parentChain = resolved.chain
  }
  const pureParent = unflattenThemeComponents(parent)
  const data = mergeThemePatch(pureParent, own, {
    id: own.id,
    title: own.title,
    ...(own.description !== undefined ? { description: own.description } : {}),
    ...(own.docs !== undefined ? { docs: own.docs } : {}),
  })
  appThemeIssue(own.id, data)
  return { data, chain: [own.id, ...parentChain], inherited: { id: parentChain[0]!, data: flattenThemeComponents(pureParent) } }
}

/** Сверка `targets` темы с версиями пакетов графа (A-38): пакет вне графа и без версии не сверяется. */
export function checkThemeTargets(data: Pick<GranumThemeData, 'targets'>, providers: ReadonlyMap<string, ProviderNode>): ThemeTargetCheck[] {
  return Object.entries(data.targets ?? {}).map(([providerId, range]): ThemeTargetCheck => {
    const provider = providers.get(providerId)
    if (!provider)
      return { providerId, range, status: 'absent' }
    if (provider.version === undefined)
      return { providerId, range, status: 'unknown-version' }
    return { providerId, range, version: provider.version, status: satisfies(provider.version, range) ? 'match' : 'mismatch' }
  })
}

function materializePick(pick: ThemePick, owner: ProviderNode | undefined, themeData: ThemeDataInput, providers: ReadonlyMap<string, ProviderNode>): ResolvedTheme {
  if (pick.kind === 'app') {
    const { data, chain, inherited } = appThemeData(pick.theme, owner, themeData)
    return {
      id: data.id,
      title: data.title,
      providerId: APP_THEME_SOURCE,
      data: flattenThemeComponents(data),
      ...(inherited !== undefined ? { inherited } : {}),
      chain,
      targets: checkThemeTargets(data, providers),
    }
  }
  const data = catalogData(owner!, pick.id, themeData)
  return { id: pick.id, title: data.title, providerId: pick.providerId, data: flattenThemeComponents(data), chain: themeChain(owner, pick.id), targets: checkThemeTargets(data, providers) }
}

/** Токены значений раздела `components` одного компонента. */
function sectionTokens(values: NonNullable<GranumThemeData['components']>[string][string]): string[] {
  return [...new Set([...Object.keys(values.root ?? {}), ...Object.values(values.modes ?? {}).flatMap(tokens => Object.keys(tokens))])].sort()
}

function matchesToken(pattern: string, token: string): boolean {
  return pattern.endsWith('*') ? token.startsWith(pattern.slice(0, -1)) : pattern === token
}

/**
 * Чьи значения задаёт тема (A-37): раздел — по манифестам графа, хуки в
 * `root`/`modes` — у компонентов селекции. Токен, пришедший в `root`/`modes`
 * слиянием раздела, судится как токен раздела: одна дыра — одна находка.
 */
function checkThemeValues(
  theme: ResolvedTheme,
  providers: ReadonlyMap<string, ProviderNode>,
  registry: Readonly<Record<string, TokenNature>>,
  selected: readonly ComponentNode[],
  warnings: ResolvedThemeWarning[],
): void {
  const fromSections = new Set<string>()
  for (const [providerId, byComponent] of Object.entries(theme.data.components ?? {})) {
    const provider = providers.get(providerId)
    for (const [name, values] of Object.entries(byComponent)) {
      const tokens = sectionTokens(values)
      for (const token of tokens)
        fromSections.add(token)
      if (!provider)
        continue
      const component = provider.components.find(c => c.name === name)
      if (!component) {
        warnings.push({ kind: 'theme-component-unknown', theme: theme.id, providerId, component: name })
        continue
      }
      // Объектный провайдер до медленного пути: требований ещё нет, судить не по чему.
      if (provider.form === 'object' && component.consumesTokens.length === 0)
        continue
      const required = new Set(component.requiresTokens)
      for (const token of tokens) {
        if (!required.has(`--${token}`) || Object.hasOwn(registry, token))
          warnings.push({ kind: 'theme-token-foreign', theme: theme.id, providerId, component: name, token, place: 'section' })
      }
    }
  }
  // Токен, который компонент требует извне, — его токен темы, даже если он подходит под шаблон хука (`--btn-*`).
  const hooks = selected.flatMap(component => component.hookTokens.map(pattern => ({ component, pattern, required: new Set(component.requiresTokens) })))
  if (hooks.length === 0)
    return
  const own = new Set([...Object.keys(theme.data.root), ...Object.values(theme.data.modes).flatMap(mode => Object.keys(mode.tokens))])
  for (const token of [...own].sort()) {
    if (fromSections.has(token))
      continue
    const hook = hooks.find(({ pattern, required }) => !required.has(`--${token}`) && matchesToken(pattern, `--${token}`))
    if (hook)
      warnings.push({ kind: 'theme-token-foreign', theme: theme.id, providerId: hook.component.providerId, component: hook.component.name, token, place: 'hook' })
  }
}

function themeModes(theme: ResolvedTheme, template: string): ResolvedMode[] {
  return themeModeOrder(theme.data).map((name) => {
    const mode = theme.data.modes[name]!
    return {
      name,
      ...(mode.title !== undefined ? { title: mode.title } : {}),
      colorScheme: mode.colorScheme,
      value: themePairValue(template, theme.id, name),
      origin: 'theme' as const,
      ...(mode.extends !== undefined ? { extends: mode.extends } : {}),
    }
  })
}

/**
 * Режимы `define` в порядке применения: база раньше наследника. Неизвестная
 * база и цикл — предупреждения; такой режим наследует режим по умолчанию.
 */
export function planModeDefinitions(
  themeModeNames: readonly string[],
  defaultMode: string,
  define: Readonly<Record<string, GranumModeDefinition>>,
  theme = '',
): { readonly order: readonly string[], readonly bases: ReadonlyMap<string, string>, readonly warnings: readonly ResolvedThemeWarning[] } {
  const order: string[] = []
  const bases = new Map<string, string>()
  const warnings: ResolvedThemeWarning[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const known = new Set(themeModeNames)

  const visit = (name: string, chain: readonly string[]): void => {
    if (state.get(name) === 'done')
      return
    state.set(name, 'visiting')
    const base = define[name]!.extends
    let resolvedBase = base
    if (state.get(base) === 'visiting') {
      warnings.push({ kind: 'mode-extends-cycle', theme, chain: [...chain, name, base] })
      resolvedBase = defaultMode
    }
    else if (Object.hasOwn(define, base) && !known.has(base)) {
      visit(base, [...chain, name])
    }
    else if (!known.has(base)) {
      warnings.push({ kind: 'mode-extends-unresolved', theme, mode: name, base })
      resolvedBase = defaultMode
    }
    bases.set(name, resolvedBase)
    state.set(name, 'done')
    order.push(name)
  }

  for (const name of Object.keys(define)) {
    if (!known.has(name))
      visit(name, [])
  }
  return { order, bases, warnings }
}

/** Пары всех тем и режимов сборки различны: иначе две пары включались бы одним значением. */
function checkCollisions(themes: readonly ResolvedBuildTheme[], attribute: string): void {
  const seen = new Map<string, string>()
  for (const entry of themes) {
    for (const mode of entry.modes) {
      const label = `theme '${entry.theme.id}' mode '${mode.name}'`
      const other = seen.get(mode.value)
      if (other !== undefined) {
        throw new ThemeResolutionError(
          'activation-collision',
          `${other} and ${label} both activate with ${attribute}="${mode.value}"; every pair must have its own value (check 'activation.value' and the 'define' names).`,
          mode.value,
        )
      }
      seen.set(mode.value, label)
    }
  }
}

/** Режимы одной темы сборки: набор, `define`, режим по умолчанию. */
function resolveBuildTheme(theme: ResolvedTheme, isDefault: boolean, input: GranumThemeModes, template: string, attribute: string, warnings: ResolvedThemeWarning[]): ResolvedBuildTheme {
  const defaultMode = theme.data.defaultMode ?? DEFAULT_MODE
  const fromTheme = themeModes(theme, template)
  const define = input.define ?? {}
  // Имя `define`, совпавшее с режимом своей темы, — та же пара: коллизия активации.
  for (const name of Object.keys(define)) {
    if (fromTheme.some(mode => mode.name === name)) {
      throw new ThemeResolutionError(
        'activation-collision',
        `'modes.define.${name}' of theme '${theme.id}' has the name of a mode of that theme, so both activate with ${attribute}="${themePairValue(template, theme.id, name)}"; give the application mode its own name.`,
        themePairValue(template, theme.id, name),
      )
    }
  }
  const definitions = planModeDefinitions(fromTheme.map(mode => mode.name), defaultMode, define, theme.id)
  warnings.push(...definitions.warnings)
  const all = new Map<string, ResolvedMode>(fromTheme.map(mode => [mode.name, mode]))
  for (const name of definitions.order) {
    const definition = define[name]!
    const base = all.get(definitions.bases.get(name)!)!
    all.set(name, {
      name,
      ...(definition.title !== undefined ? { title: definition.title } : {}),
      colorScheme: definition.colorScheme ?? base.colorScheme,
      value: themePairValue(template, theme.id, name),
      origin: 'define',
      extends: base.name,
    })
  }

  let names: string[]
  if (input.names !== undefined) {
    for (const name of input.names) {
      if (!all.has(name)) {
        throw new ThemeResolutionError(
          'unknown-mode',
          `mode '${name}' is neither a mode of theme '${theme.id}' nor defined in its 'modes.define'. Available: ${[...all.keys()].join(', ')}.`,
          name,
          [...all.keys()],
        )
      }
    }
    names = [...new Set(input.names)]
  }
  else {
    // Без `names` — режим по умолчанию темы и режимы приложения: тема
    // собирается под приложение, и второй режим темы — решение, а не умолчание.
    names = [defaultMode, ...definitions.order]
  }
  // Режим по умолчанию — первым, если он в наборе.
  if (names.includes(defaultMode))
    names = [defaultMode, ...names.filter(name => name !== defaultMode)]

  for (const key of Object.keys(input.tokenOverrides ?? {})) {
    if (key !== 'root' && !names.includes(key)) {
      throw new ThemeResolutionError(
        'unknown-mode',
        `'modes.tokenOverrides.${key}' of theme '${theme.id}' names a mode that is not built. Modes: ${names.join(', ') || '—'}; mode-independent tokens go to 'modes.tokenOverrides.root'.`,
        key,
        names,
      )
    }
  }

  return {
    theme,
    isDefault,
    modes: names.map(name => all.get(name)!),
    definitions: definitions.order.map(name => all.get(name)!),
    modesSource: input.names !== undefined ? 'explicit' : 'theme',
    defaultMode: names.includes(defaultMode) ? defaultMode : (names[0] ?? defaultMode),
    input,
  }
}

/**
 * Резолюция тем: темы сборки, их режимы, активация и предупреждения.
 * Данные тем каталога приносит node-слой (`themeData`): ядро файлов не читает.
 */
export function resolveThemes(
  providers: readonly ProviderNode[],
  input: ResolveThemesInput = {},
  components: readonly ComponentNode[] = [],
  themeData: ThemeDataInput = {},
  registry: Readonly<Record<string, TokenNature>> = {},
): ResolvedThemes {
  const plan = planThemes(providers, input)
  const attribute = input.activation?.attribute ?? DEFAULT_ACTIVATION_ATTRIBUTE
  const template = input.activation?.value ?? DEFAULT_ACTIVATION_VALUE
  const activation = { attribute, value: template }
  const system = input.activation?.system ?? 'none'
  const warnings: ResolvedThemeWarning[] = []

  if (plan.themes.length === 0) {
    // Без тем активации некуда лечь: заданная, она молча не теряется.
    if (input.activation !== undefined) {
      throw new ThemeResolutionError(
        'theme-missing',
        `'activation' is set, but the build has no themes: no provider in the graph declares a theme catalog and 'themes' lists no theme object — it would activate nothing.`,
      )
    }
    return { themes: [], default: undefined, themeSource: undefined, owner: plan.owner?.id, activation, system, warnings }
  }

  if (!template.includes('{mode}'))
    throw new ThemeResolutionError('activation-collision', `'activation.value' must contain '{mode}' (got '${template}'): without it every mode activates with the same value.`, template)

  const graph = new Map(providers.map(provider => [provider.id, provider]))
  const resolved = plan.themes.map(planned => ({ planned, theme: materializePick(planned.pick, plan.owner, themeData, graph) }))
  for (const { theme } of resolved) {
    for (const check of theme.targets) {
      if (check.status === 'mismatch')
        warnings.push({ kind: 'theme-target-mismatch', theme: theme.id, providerId: check.providerId, range: check.range, version: check.version! })
    }
    checkThemeValues(theme, graph, registry, components, warnings)
  }

  const knownThemes = new Set(plan.owner ? Object.keys(plan.owner.theme.catalog) : [])
  for (const { theme } of resolved) {
    for (const id of theme.chain)
      knownThemes.add(id)
  }
  for (const component of components) {
    for (const id of Object.keys(component.themeTokens)) {
      if (!knownThemes.has(id))
        warnings.push({ kind: 'component-theme-unknown', providerId: component.providerId, component: component.name, theme: id })
    }
  }

  const themes = resolved.map(({ planned, theme }) => resolveBuildTheme(theme, planned.isDefault, planned.modes, template, attribute, warnings))
  checkCollisions(themes, attribute)

  return {
    themes,
    default: themes.find(entry => entry.isDefault),
    themeSource: plan.source,
    owner: plan.owner?.id,
    activation,
    system,
    warnings,
  }
}

/** Режимы-предки режима темы по `extends` и режим по умолчанию — порядок поиска токенов компонента. */
export function componentModeSequence(data: GranumThemeData, mode: string): string[] {
  const sequence = [...modeChain(data, mode).names]
  const defaultMode = data.defaultMode ?? DEFAULT_MODE
  if (!sequence.includes(defaultMode))
    sequence.push(defaultMode)
  return sequence
}
