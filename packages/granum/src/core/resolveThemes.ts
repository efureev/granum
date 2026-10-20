/**
 * Активная тема и её режимы: владелец каталога, выбор темы,
 * набор режимов с `define`, активация и превью. Значения токенов считает
 * `tokenLayers` — здесь только то, ЧТО собирается.
 */
import type { GranumComponentThemeTokens, GranumModeFallback, GranumThemeData, GranumTokenRef } from '../contract'
import type { ComponentNode, ProviderNode } from './providerNode'
import { themePairValue } from '../runtime/manifest'
import { DEFAULT_ACTIVATION_ATTRIBUTE, DEFAULT_ACTIVATION_VALUE } from './activation'
import { ThemeResolutionError } from './errors'
import { ownsThemes } from './providerNode'
import { DEFAULT_MODE, modeChain, themeModeOrder } from './themeData'

/** Идентификатор источника для вкладов самого приложения. */
export const APP_THEME_SOURCE = '(app)'

/**
 * Тема-объект приложения: полные данные. `extends` называет тему каталога,
 * чьи токены компонентов служат основой: данные он не дополняет —
 * наследование данных приложение разрешает само, до конфига.
 */
export interface GranumAppTheme extends GranumThemeData {
  readonly extends?: string
  /** Файлы, из которых собран объект: их правка в dev перезагружает конфиг. */
  readonly sources?: readonly string[]
}

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

export interface GranumModeActivation {
  /** Атрибут на корне. По умолчанию `data-theme`. */
  readonly attribute?: string
  /** Шаблон значения с `{theme}` и `{mode}`. По умолчанию `{theme}-{mode}`. */
  readonly value?: string
}

export interface GranumModesInput {
  /** `undefined` — режим по умолчанию темы плюс `define`; `[]` — режимов нет. */
  readonly names?: readonly string[]
  readonly define?: Readonly<Record<string, GranumModeDefinition>>
  readonly activation?: GranumModeActivation
  /** `root` — режимонезависимые токены, остальные ключи — режимы. Ключи токенов без `--`. */
  readonly tokenOverrides?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Override токена, которого нет ни в данных темы, ни в токенах компонентов, отбрасывается. */
  readonly strictTokens?: boolean
  /** `media` — тёмный режим по `prefers-color-scheme`, пока атрибут не выставлен. */
  readonly system?: 'none' | 'media'
}

export type GranumThemeChoice = string | GranumAppTheme

/** Тема и режимы — часть конфига, которую понимает ядро. */
export interface ResolveThemesInput {
  readonly theme?: GranumThemeChoice
  readonly previews?: readonly GranumThemeChoice[]
  readonly modes?: GranumModesInput
}

/** Данные тем каталога, прочитанные node-слоем: провайдер → id темы → данные. */
export type ThemeDataInput = Readonly<Record<string, Readonly<Record<string, GranumThemeData>>>>

/** Токены компонентов объектной формы из `themesDir`: провайдер → компонент → тема → токены. */
export type ComponentThemesInput = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, GranumComponentThemeTokens>>>>>>

export type ThemeSource = 'app' | 'provider' | 'default'
export type ModesSource = 'explicit' | 'theme'

export interface ResolvedTheme {
  readonly id: string
  readonly title: string
  /** Владелец каталога; у темы-объекта приложения — {@link APP_THEME_SOURCE}. */
  readonly providerId: string
  readonly data: GranumThemeData
  /** Цепочка тем для токенов компонентов: сама тема, затем предки по каталогу. */
  readonly chain: readonly string[]
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

export interface ResolvedPreview {
  readonly theme: ResolvedTheme
  readonly modes: readonly ResolvedMode[]
}

export type ResolvedThemeWarning
  = | { readonly kind: 'component-theme-unknown', readonly providerId: string, readonly component: string, readonly theme: string }
    | { readonly kind: 'mode-extends-unresolved', readonly mode: string, readonly base: string }
    | { readonly kind: 'mode-extends-cycle', readonly chain: readonly string[] }

export interface ResolvedThemes {
  /** Активная тема; `undefined` — тем нет, слой `themes` пуст. */
  readonly theme: ResolvedTheme | undefined
  readonly themeSource: ThemeSource | undefined
  /** Владелец каталога в графе. */
  readonly owner: string | undefined
  /** Режимы в порядке эмиссии: режим по умолчанию первым. */
  readonly modes: readonly ResolvedMode[]
  /** Все режимы `define`, включая не вошедшие в набор, — база раньше наследника. */
  readonly definitions: readonly ResolvedMode[]
  readonly modesSource: ModesSource
  readonly defaultMode: string | undefined
  readonly activation: { readonly attribute: string, readonly value: string }
  readonly system: 'none' | 'media'
  readonly previews: readonly ResolvedPreview[]
  readonly warnings: readonly ResolvedThemeWarning[]
}

/** Тема, выбранная до чтения данных: id каталога или объект приложения. */
export type ThemePick
  = | { readonly kind: 'catalog', readonly providerId: string, readonly id: string, readonly data: string }
    | { readonly kind: 'app', readonly theme: GranumAppTheme }

export interface ThemePlan {
  readonly owner: ProviderNode | undefined
  readonly active: ThemePick | undefined
  readonly source: ThemeSource | undefined
  readonly previews: readonly ThemePick[]
}

/** Владелец каталога: 0 или 1 в графе. */
export function findThemeOwner(providers: readonly ProviderNode[]): ProviderNode | undefined {
  const owners = providers.filter(ownsThemes)
  if (owners.length > 1) {
    throw new ThemeResolutionError(
      'multiple-theme-owners',
      `${owners.map(o => `'${o.id}'`).join(' and ')} both declare a theme catalog; granum 3 supports one catalog owner per application. `
      + `Pass the extra themes as an application theme object in 'theme' instead.`,
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

function pickCatalogTheme(owner: ProviderNode | undefined, key: string, role: 'theme' | 'preview'): ThemePick {
  const { providerId, id } = splitThemeKey(key)
  const available = owner ? Object.keys(owner.theme.catalog) : []
  const entry = owner && (providerId === undefined || providerId === owner.id) ? owner.theme.catalog[id] : undefined
  if (!owner || !entry) {
    throw new ThemeResolutionError(
      'unknown-theme',
      owner
        ? `${role} '${key}' is not in the catalog of '${owner.id}'. Available: ${available.join(', ') || '—'}.`
        : `${role} '${key}' is requested, but no provider in the graph declares a theme catalog.`,
      key,
      available,
    )
  }
  return { kind: 'catalog', providerId: owner.id, id, data: entry.data }
}

/**
 * Что собирается: владелец, активная тема и превью — до чтения данных.
 * Node-слой читает по этому плану только нужные файлы.
 */
export function planThemes(providers: readonly ProviderNode[], input: ResolveThemesInput = {}): ThemePlan {
  const owner = findThemeOwner(providers)
  let active: ThemePick | undefined
  let source: ThemeSource | undefined
  if (typeof input.theme === 'string') {
    active = pickCatalogTheme(owner, input.theme, 'theme')
    source = 'provider'
  }
  else if (input.theme !== undefined) {
    active = { kind: 'app', theme: input.theme }
    source = 'app'
  }
  else if (owner) {
    const ids = Object.keys(owner.theme.catalog)
    const id = owner.theme.defaultTheme ?? (ids.length === 1 ? ids[0] : undefined)
    if (id === undefined) {
      throw new ThemeResolutionError(
        'unknown-theme',
        `'${owner.id}' declares ${ids.length} themes and no 'defaultTheme'; choose one with 'theme' in granum.config. Available: ${ids.join(', ')}.`,
        undefined,
        ids,
      )
    }
    active = pickCatalogTheme(owner, id, 'theme')
    source = 'default'
  }
  const previews = (input.previews ?? []).map(choice => (typeof choice === 'string' ? pickCatalogTheme(owner, choice, 'preview') : { kind: 'app' as const, theme: choice }))
  return { owner, active, source, previews }
}

function themeChain(owner: ProviderNode | undefined, id: string | undefined): string[] {
  const chain: string[] = []
  for (let current = id; current !== undefined && !chain.includes(current); current = owner?.theme.catalog[current]?.extends)
    chain.push(current)
  return chain
}

function materializePick(pick: ThemePick, owner: ProviderNode | undefined, themeData: ThemeDataInput): ResolvedTheme {
  if (pick.kind === 'app') {
    const { extends: base, sources: _sources, ...data } = pick.theme
    // Неизвестная база молча не дала бы токенов компонентов своей цепочки.
    if (base !== undefined && owner?.theme.catalog[base] === undefined) {
      const available = owner ? Object.keys(owner.theme.catalog) : []
      throw new ThemeResolutionError(
        'unknown-theme',
        owner
          ? `theme object '${data.id}' extends '${base}', which is not in the catalog of '${owner.id}'. Available: ${available.join(', ') || '—'}.`
          : `theme object '${data.id}' extends '${base}', but no provider in the graph declares a theme catalog.`,
        base,
        available,
      )
    }
    return { id: data.id, title: data.title, providerId: APP_THEME_SOURCE, data, chain: [data.id, ...themeChain(owner, base)] }
  }
  const data = themeData[pick.providerId]?.[pick.id]
  if (!data) {
    throw new ThemeResolutionError(
      'theme-data-missing',
      `the data of theme '${pick.id}' of '${pick.providerId}' was not supplied to the resolver (expected at '${pick.data}').`,
      pick.id,
    )
  }
  return { id: pick.id, title: data.title, providerId: pick.providerId, data, chain: themeChain(owner, pick.id) }
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
      warnings.push({ kind: 'mode-extends-cycle', chain: [...chain, name, base] })
      resolvedBase = defaultMode
    }
    else if (Object.hasOwn(define, base) && !known.has(base)) {
      visit(base, [...chain, name])
    }
    else if (!known.has(base)) {
      warnings.push({ kind: 'mode-extends-unresolved', mode: name, base })
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

function checkCollisions(modes: readonly ResolvedMode[], previews: readonly ResolvedPreview[], attribute: string): void {
  const seen = new Map<string, string>()
  const entries = [
    ...modes.map(mode => ({ value: mode.value, label: `mode '${mode.name}'` })),
    ...previews.flatMap(preview => preview.modes.map(mode => ({ value: mode.value, label: `preview '${preview.theme.id}' mode '${mode.name}'` }))),
  ]
  for (const { value, label } of entries) {
    const other = seen.get(value)
    if (other !== undefined) {
      throw new ThemeResolutionError(
        'activation-collision',
        `${other} and ${label} both activate with ${attribute}="${value}"; every pair must have its own value (check 'modes.activation.value' and 'modes.define' names).`,
        value,
      )
    }
    seen.set(value, label)
  }
}

/**
 * Резолюция тем: выбор темы, режимы, активация, превью и предупреждения.
 * Данные тем каталога приносит node-слой (`themeData`): ядро файлов не читает.
 */
export function resolveThemes(
  providers: readonly ProviderNode[],
  input: ResolveThemesInput = {},
  components: readonly ComponentNode[] = [],
  themeData: ThemeDataInput = {},
): ResolvedThemes {
  const plan = planThemes(providers, input)
  const modesInput = input.modes ?? {}
  const attribute = modesInput.activation?.attribute ?? DEFAULT_ACTIVATION_ATTRIBUTE
  const template = modesInput.activation?.value ?? DEFAULT_ACTIVATION_VALUE
  const activation = { attribute, value: template }
  const system = modesInput.system ?? 'none'
  const warnings: ResolvedThemeWarning[] = []

  const knownThemes = new Set(plan.owner ? Object.keys(plan.owner.theme.catalog) : [])
  const theme = plan.active ? materializePick(plan.active, plan.owner, themeData) : undefined
  if (theme)
    knownThemes.add(theme.id)
  for (const component of components) {
    for (const id of Object.keys(component.themeTokens)) {
      if (!knownThemes.has(id))
        warnings.push({ kind: 'component-theme-unknown', providerId: component.providerId, component: component.name, theme: id })
    }
  }

  if (!theme) {
    // Без темы режимам и превью некуда лечь: их значения молча не теряются.
    const carrying = [
      ...(modesInput.names?.length ? ['modes.names'] : []),
      ...(Object.keys(modesInput.define ?? {}).length > 0 ? ['modes.define'] : []),
      ...(Object.keys(modesInput.tokenOverrides ?? {}).length > 0 ? ['modes.tokenOverrides'] : []),
      ...(plan.previews.length > 0 ? ['previews'] : []),
    ]
    if (carrying.length > 0) {
      throw new ThemeResolutionError(
        'theme-missing',
        `${carrying.join(', ')} ${carrying.length > 1 ? 'are' : 'is'} set, but the build has no active theme: no provider in the graph declares a theme catalog and 'theme' is not a theme object — the values would land nowhere.`,
      )
    }
    return {
      theme: undefined,
      themeSource: undefined,
      owner: plan.owner?.id,
      modes: [],
      definitions: [],
      modesSource: modesInput.names !== undefined ? 'explicit' : 'theme',
      defaultMode: undefined,
      activation,
      system,
      previews: [],
      warnings,
    }
  }

  if (!template.includes('{mode}'))
    throw new ThemeResolutionError('activation-collision', `'modes.activation.value' must contain '{mode}' (got '${template}'): without it every mode activates with the same value.`, template)

  const defaultMode = theme.data.defaultMode ?? DEFAULT_MODE
  const fromTheme = themeModes(theme, template)
  const define = modesInput.define ?? {}
  // Имя `define`, совпавшее с режимом темы, — та же пара: коллизия активации.
  for (const name of Object.keys(define)) {
    if (fromTheme.some(mode => mode.name === name)) {
      throw new ThemeResolutionError(
        'activation-collision',
        `'modes.define.${name}' has the name of a mode of theme '${theme.id}', so both activate with ${attribute}="${themePairValue(template, theme.id, name)}"; give the application mode its own name.`,
        themePairValue(template, theme.id, name),
      )
    }
  }
  const definitions = planModeDefinitions(fromTheme.map(mode => mode.name), defaultMode, define)
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
  if (modesInput.names !== undefined) {
    for (const name of modesInput.names) {
      if (!all.has(name)) {
        throw new ThemeResolutionError(
          'unknown-mode',
          `mode '${name}' is neither a mode of theme '${theme.id}' nor defined in 'modes.define'. Available: ${[...all.keys()].join(', ')}.`,
          name,
          [...all.keys()],
        )
      }
    }
    names = [...new Set(modesInput.names)]
  }
  else {
    // Без `modes.names` — режим по умолчанию темы и режимы приложения: тема
    // собирается под приложение, и второй режим темы — решение, а не умолчание.
    names = [defaultMode, ...definitions.order]
  }
  // Режим по умолчанию — первым, если он в наборе: под `:root` его блок решает позиция.
  if (names.includes(defaultMode))
    names = [defaultMode, ...names.filter(name => name !== defaultMode)]

  for (const key of Object.keys(modesInput.tokenOverrides ?? {})) {
    if (key !== 'root' && !names.includes(key)) {
      throw new ThemeResolutionError(
        'unknown-mode',
        `'modes.tokenOverrides.${key}' names a mode that is not built. Modes: ${names.join(', ') || '—'}; mode-independent tokens go to 'modes.tokenOverrides.root'.`,
        key,
        names,
      )
    }
  }

  const previews = plan.previews.map((pick) => {
    const previewTheme = materializePick(pick, plan.owner, themeData)
    return { theme: previewTheme, modes: themeModes(previewTheme, template) }
  })
  const modes = names.map(name => all.get(name)!)
  checkCollisions(modes, previews, attribute)

  return {
    theme,
    themeSource: plan.source,
    owner: plan.owner?.id,
    modes,
    definitions: definitions.order.map(name => all.get(name)!),
    modesSource: modesInput.names !== undefined ? 'explicit' : 'theme',
    defaultMode: names.includes(defaultMode) ? defaultMode : names[0],
    activation,
    system,
    previews,
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
