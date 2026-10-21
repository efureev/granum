/**
 * Данные темы (`GranumThemeData`): форма, цепочки режимов, наследование темы
 * от темы и полнота по реестру. Чистые функции — их зовут сборка провайдера,
 * чтение данных приложением и проверка темы-объекта в конфиге.
 */
import type { GranumModeData, GranumThemeComponentValues, GranumThemeData } from '../contract/types'
import { isValidRange, isVersion } from './semver'

/** Id пакета раздела — имя npm-пакета: оно становится путём папки в исходнике и копии. */
const PACKAGE_ID_PATTERN = /^(?:@[a-z0-9~-][\w.~-]*\/)?[a-z0-9~-][\w.~-]*$/
/** Имя компонента — сегмент пути `components/<Name>/`, как у дескриптора. */
const COMPONENT_NAME_PATTERN = /^[a-z][\w-]*$/i

export const THEME_ID_PATTERN = /^[a-z][a-z0-9-]*$/
export const MODE_NAME_PATTERN = /^[a-z][a-z0-9]*$/
export const DEFAULT_MODE = 'light'

export function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && THEME_ID_PATTERN.test(value)
}

/** Имя режима — без дефиса: иначе пара `<тема>-<режим>` не разбирается по последнему дефису. */
export function isModeName(value: unknown): value is string {
  return typeof value === 'string' && MODE_NAME_PATTERN.test(value) && value !== 'root'
}

export type ThemeDataIssueReason
  = | 'invalid-theme-id'
    | 'invalid-mode-name'
    | 'invalid-theme-data'
    | 'token-key-prefix'
    | 'default-mode-missing'
    | 'mode-extends-unknown'
    | 'mode-extends-cycle'
    | 'invalid-theme-version'
    | 'invalid-theme-targets'
    | 'invalid-theme-component-mode'
    | 'theme-token-collision'
    | 'theme-components-untargeted'

/** Нарушение формы данных: вызывающий превращает его в ошибку своего слоя. */
export interface ThemeDataIssue {
  readonly reason: ThemeDataIssueReason
  /** Путь до поля внутри данных: `modes.dark.tokens`. */
  readonly path: string
  readonly details: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenRecordIssue(value: unknown, path: string): ThemeDataIssue | undefined {
  if (!isRecord(value))
    return { reason: 'invalid-theme-data', path, details: 'expected an object of token values' }
  for (const [key, token] of Object.entries(value)) {
    if (typeof token !== 'string')
      return { reason: 'invalid-theme-data', path: `${path}.${key}`, details: 'expected a string value' }
    if (key.startsWith('--'))
      return { reason: 'token-key-prefix', path, details: `token key '${key}' must not start with '--' — the generator adds it` }
  }
  return undefined
}

/**
 * Форма данных темы. `partial` — исходник темы с `extends` в каталоге: в нём
 * только отличия, и обязательных полей режима и корня может не быть.
 */
export function checkThemeData(raw: unknown, options: { readonly partial?: boolean, readonly flattened?: boolean } = {}): ThemeDataIssue | undefined {
  const partial = options.partial === true
  if (!isRecord(raw))
    return { reason: 'invalid-theme-data', path: '', details: 'expected an object' }
  if (!partial || raw.id !== undefined) {
    if (!isThemeId(raw.id))
      return { reason: 'invalid-theme-id', path: 'id', details: `expected a slug /^[a-z][a-z0-9-]*$/, got ${JSON.stringify(raw.id)}` }
  }
  if (!partial || raw.title !== undefined) {
    if (typeof raw.title !== 'string' || raw.title.length === 0)
      return { reason: 'invalid-theme-data', path: 'title', details: 'expected a non-empty string' }
  }
  for (const key of ['description', 'docs', 'defaultMode'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string')
      return { reason: 'invalid-theme-data', path: key, details: 'expected a string' }
  }
  if (!partial || raw.root !== undefined) {
    const issue = tokenRecordIssue(raw.root, 'root')
    if (issue)
      return issue
  }
  if (!partial || raw.modes !== undefined) {
    if (!isRecord(raw.modes))
      return { reason: 'invalid-theme-data', path: 'modes', details: 'expected an object of modes' }
    for (const [name, mode] of Object.entries(raw.modes)) {
      const at = `modes.${name}`
      if (!isModeName(name))
        return { reason: 'invalid-mode-name', path: at, details: `mode name must match /^[a-z][a-z0-9]*$/ and not be 'root', got '${name}'` }
      if (!isRecord(mode))
        return { reason: 'invalid-theme-data', path: at, details: 'expected an object' }
      if (!partial || mode.colorScheme !== undefined) {
        if (mode.colorScheme !== 'light' && mode.colorScheme !== 'dark')
          return { reason: 'invalid-theme-data', path: `${at}.colorScheme`, details: `expected 'light' or 'dark', got ${JSON.stringify(mode.colorScheme)}` }
      }
      if (mode.title !== undefined && typeof mode.title !== 'string')
        return { reason: 'invalid-theme-data', path: `${at}.title`, details: 'expected a string' }
      if (mode.extends !== undefined && typeof mode.extends !== 'string')
        return { reason: 'invalid-theme-data', path: `${at}.extends`, details: 'expected a mode name' }
      if (!partial || mode.tokens !== undefined) {
        const issue = tokenRecordIssue(mode.tokens, `${at}.tokens`)
        if (issue)
          return issue
      }
      if (mode.fallbacks !== undefined) {
        if (!Array.isArray(mode.fallbacks))
          return { reason: 'invalid-theme-data', path: `${at}.fallbacks`, details: 'expected an array' }
        for (const [i, fallback] of mode.fallbacks.entries()) {
          if (!isRecord(fallback) || typeof fallback.supports !== 'string' || fallback.supports.trim().length === 0)
            return { reason: 'invalid-theme-data', path: `${at}.fallbacks.${i}`, details: 'expected { supports: string, tokens }' }
          const issue = tokenRecordIssue(fallback.tokens, `${at}.fallbacks.${i}.tokens`)
          if (issue)
            return issue
        }
      }
    }
  }
  if (raw.baseCss !== undefined && (!Array.isArray(raw.baseCss) || !raw.baseCss.every(css => typeof css === 'string')))
    return { reason: 'invalid-theme-data', path: 'baseCss', details: 'expected an array of CSS strings' }
  if (raw.extensions !== undefined && !isRecord(raw.extensions))
    return { reason: 'invalid-theme-data', path: 'extensions', details: 'expected an object' }
  const versioning = checkVersioning(raw)
  if (versioning)
    return versioning
  const components = checkComponentsShape(raw.components)
  if (components)
    return components
  if (partial)
    return undefined
  return checkModeGraph(raw as unknown as GranumThemeData) ?? checkThemeComponents(raw as unknown as GranumThemeData, options)
}

function checkVersioning(raw: Record<string, unknown>): ThemeDataIssue | undefined {
  if (raw.version !== undefined && !isVersion(raw.version))
    return { reason: 'invalid-theme-version', path: 'version', details: `expected MAJOR.MINOR.PATCH with an optional pre-release, got ${JSON.stringify(raw.version)}` }
  if (raw.targets === undefined)
    return undefined
  if (!isRecord(raw.targets))
    return { reason: 'invalid-theme-targets', path: 'targets', details: 'expected an object: provider id -> semver range' }
  for (const [provider, range] of Object.entries(raw.targets)) {
    if (provider.length === 0)
      return { reason: 'invalid-theme-targets', path: 'targets', details: 'a provider id must not be empty' }
    if (!isValidRange(range))
      return { reason: 'invalid-theme-targets', path: `targets.${provider}`, details: `expected a semver range (^, ~, x, comparators, hyphen, ||), got ${JSON.stringify(range)}` }
  }
  return undefined
}

function checkComponentsShape(raw: unknown): ThemeDataIssue | undefined {
  if (raw === undefined)
    return undefined
  if (!isRecord(raw))
    return { reason: 'invalid-theme-data', path: 'components', details: 'expected an object: provider id -> component -> values' }
  for (const [provider, byComponent] of Object.entries(raw)) {
    const at = `components.${provider}`
    if (!PACKAGE_ID_PATTERN.test(provider))
      return { reason: 'invalid-theme-data', path: at, details: `'${provider}' is not a package name [@scope/]name` }
    if (!isRecord(byComponent))
      return { reason: 'invalid-theme-data', path: at, details: 'expected an object: component name -> values' }
    for (const [name, values] of Object.entries(byComponent)) {
      const here = `${at}.${name}`
      if (!COMPONENT_NAME_PATTERN.test(name))
        return { reason: 'invalid-theme-data', path: here, details: `'${name}' is not a component name /^[A-Z][\\w-]*$/i` }
      if (!isRecord(values))
        return { reason: 'invalid-theme-data', path: here, details: 'expected { root?, modes? }' }
      for (const key of Object.keys(values)) {
        if (key !== 'root' && key !== 'modes')
          return { reason: 'invalid-theme-data', path: `${here}.${key}`, details: `unknown key; component values are { root?, modes? }` }
      }
      if (values.root !== undefined) {
        const issue = tokenRecordIssue(values.root, `${here}.root`)
        if (issue)
          return issue
      }
      if (values.modes !== undefined) {
        if (!isRecord(values.modes))
          return { reason: 'invalid-theme-data', path: `${here}.modes`, details: 'expected an object: mode -> tokens' }
        for (const [mode, tokens] of Object.entries(values.modes)) {
          const issue = tokenRecordIssue(tokens, `${here}.modes.${mode}`)
          if (issue)
            return issue
        }
      }
    }
  }
  return undefined
}

/**
 * Раздел `components` полной темы (C-40, C-41): режимы раздела — режимы темы, у
 * значения одно место, пакет раздела — в `targets`. `flattened` — данные, где
 * значения раздела могут быть ещё и слиты в `root`/`modes` (C-44): копия на том же
 * месте с тем же значением — след слияния, иная — коллизия.
 */
export function checkThemeComponents(data: GranumThemeData, options: { readonly flattened?: boolean } = {}): ThemeDataIssue | undefined {
  const components = data.components ?? {}
  for (const [provider, byComponent] of Object.entries(components)) {
    for (const [name, values] of Object.entries(byComponent)) {
      for (const mode of Object.keys(values.modes ?? {})) {
        if (!Object.hasOwn(data.modes, mode)) {
          return {
            reason: 'invalid-theme-component-mode',
            path: `components.${provider}.${name}.modes.${mode}`,
            details: `'${mode}' is not a mode of the theme (${Object.keys(data.modes).join(', ')})`,
          }
        }
      }
    }
    if (data.targets === undefined || !Object.hasOwn(data.targets, provider)) {
      return {
        reason: 'theme-components-untargeted',
        path: `components.${provider}`,
        details: `the theme sets values of '${provider}' components, but 'targets' does not name '${provider}': a theme sets values only for the packages it is written for`,
      }
    }
  }
  return themeTokenCollision(options.flattened ? unflattenThemeComponents(data) : data)
}

/** Токен, который стоит в данных темы в двух местах (C-40): у значения один владелец. */
export function themeTokenCollision(data: GranumThemeData): ThemeDataIssue | undefined {
  const places = new Map<string, string>()
  const claim = (token: string, place: string): ThemeDataIssue | undefined => {
    const other = places.get(token)
    if (other !== undefined && other !== place)
      return { reason: 'theme-token-collision', path: place, details: `token '${token}' is set in ${other} and in ${place}; a value has one owner — keep it in one place` }
    places.set(token, place)
    return undefined
  }
  for (const token of Object.keys(data.root)) {
    const issue = claim(token, 'the theme')
    if (issue)
      return issue
  }
  for (const mode of Object.values(data.modes)) {
    for (const token of Object.keys(mode.tokens)) {
      const issue = claim(token, 'the theme')
      if (issue)
        return issue
    }
  }
  for (const [provider, byComponent] of Object.entries(data.components ?? {})) {
    for (const [name, values] of Object.entries(byComponent)) {
      const rootPlace = `components.${provider}.${name}.root`
      const modesPlace = `components.${provider}.${name}.modes`
      for (const token of Object.keys(values.root ?? {})) {
        const issue = claim(token, rootPlace)
        if (issue)
          return issue
      }
      for (const tokens of Object.values(values.modes ?? {})) {
        for (const token of Object.keys(tokens)) {
          const issue = claim(token, modesPlace)
          if (issue)
            return issue
        }
      }
    }
  }
  return undefined
}

/** `defaultMode` и цепочки `extends` режимов полной темы. */
export function checkModeGraph(data: GranumThemeData): ThemeDataIssue | undefined {
  const defaultMode = data.defaultMode ?? DEFAULT_MODE
  if (!Object.hasOwn(data.modes, defaultMode)) {
    return {
      reason: 'default-mode-missing',
      path: data.defaultMode === undefined ? 'modes' : 'defaultMode',
      details: data.defaultMode === undefined
        ? `no 'defaultMode' is set, so mode '${DEFAULT_MODE}' must exist (modes: ${Object.keys(data.modes).join(', ') || '—'})`
        : `'${defaultMode}' is not one of the modes (${Object.keys(data.modes).join(', ')})`,
    }
  }
  for (const [name, mode] of Object.entries(data.modes)) {
    if (mode.extends !== undefined && !Object.hasOwn(data.modes, mode.extends))
      return { reason: 'mode-extends-unknown', path: `modes.${name}.extends`, details: `mode '${name}' extends '${mode.extends}', which is not a mode of the theme` }
  }
  for (const name of Object.keys(data.modes)) {
    const chain = modeChain(data, name)
    if (chain.cycle)
      return { reason: 'mode-extends-cycle', path: `modes.${name}.extends`, details: `modes extend each other in a cycle: ${chain.names.join(' -> ')}` }
  }
  return undefined
}

/** Цепочка режима: сам режим, затем предки по `extends`. Обрывается на цикле. */
export function modeChain(data: Pick<GranumThemeData, 'modes'>, mode: string): { readonly names: readonly string[], readonly cycle: boolean } {
  const names: string[] = []
  let current: string | undefined = mode
  while (current !== undefined) {
    if (names.includes(current))
      return { names: [...names, current], cycle: true }
    names.push(current)
    current = data.modes[current]?.extends
  }
  return { names, cycle: false }
}

/** Итоговые токены режима: предки по цепочке, затем свои. */
export function modeTokens(data: Pick<GranumThemeData, 'modes'>, mode: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of [...modeChain(data, mode).names].reverse())
    Object.assign(out, data.modes[name]?.tokens)
  return out
}

/** Режимы темы в порядке эмиссии: режим по умолчанию первым, затем порядок ключей данных. */
export function themeModeOrder(data: Pick<GranumThemeData, 'modes' | 'defaultMode'>): string[] {
  const defaultMode = data.defaultMode ?? DEFAULT_MODE
  return [defaultMode, ...Object.keys(data.modes).filter(name => name !== defaultMode)]
}

/** Исходник темы с `extends` в каталоге: только отличия от родителя. */
export interface ThemePatch {
  readonly id?: string
  readonly title?: string
  readonly description?: string
  readonly docs?: string
  readonly root?: Readonly<Record<string, string>>
  readonly modes?: Readonly<Record<string, Partial<GranumModeData>>>
  readonly defaultMode?: string
  readonly baseCss?: readonly string[]
  readonly extensions?: Readonly<Record<string, unknown>>
  readonly version?: string
  readonly targets?: Readonly<Record<string, string>>
  readonly components?: Readonly<Record<string, Readonly<Record<string, GranumThemeComponentValues>>>>
}

/** Раздел `components` потомка поверх родительского: по пакету, компоненту, `root` или режиму и токену. */
function mergeComponents(
  parent: GranumThemeData['components'],
  patch: ThemePatch['components'],
): GranumThemeData['components'] {
  if (!parent && !patch)
    return undefined
  const out: Record<string, Record<string, GranumThemeComponentValues>> = {}
  for (const source of [parent, patch]) {
    for (const [provider, byComponent] of Object.entries(source ?? {})) {
      const target = out[provider] ??= {}
      for (const [name, values] of Object.entries(byComponent)) {
        const base = target[name]
        const root = values.root || base?.root ? { ...base?.root, ...values.root } : undefined
        const modes: Record<string, Readonly<Record<string, string>>> = { ...base?.modes }
        for (const [mode, tokens] of Object.entries(values.modes ?? {}))
          modes[mode] = { ...modes[mode], ...tokens }
        target[name] = {
          ...(root !== undefined ? { root } : {}),
          ...(Object.keys(modes).length > 0 ? { modes } : {}),
        }
      }
    }
  }
  return out
}

/**
 * Тема с `extends` — родитель плюс отличия (C-27). Токены сливаются по ключу,
 * раздел `components` — по пакету, компоненту, `root` или режиму и токену;
 * фолбэки режима и `baseCss` отличий заменяют родительские целиком,
 * `extensions` сливаются на верхнем уровне. `targets` — свои или родителя,
 * `version` — только своя: версия родителя не версия потомка. Метаданные — из
 * `meta` (записи каталога или `theme.json` исходника), а не из родителя.
 */
export function mergeThemePatch(
  parent: GranumThemeData,
  patch: ThemePatch,
  meta: Pick<GranumThemeData, 'id' | 'title' | 'description' | 'docs'>,
): GranumThemeData {
  const modes: Record<string, GranumModeData> = {}
  for (const [name, mode] of Object.entries(parent.modes))
    modes[name] = mode
  for (const [name, mode] of Object.entries(patch.modes ?? {})) {
    const base = modes[name]
    const title = mode.title ?? base?.title
    const colorScheme = mode.colorScheme ?? base?.colorScheme
    const fallbacks = mode.fallbacks ?? base?.fallbacks
    const extendsMode = mode.extends ?? base?.extends
    modes[name] = {
      ...(title !== undefined ? { title } : {}),
      colorScheme: colorScheme!,
      ...(extendsMode !== undefined ? { extends: extendsMode } : {}),
      tokens: { ...base?.tokens, ...mode.tokens },
      ...(fallbacks !== undefined ? { fallbacks } : {}),
    }
  }
  const baseCss = patch.baseCss ?? parent.baseCss
  const extensions = patch.extensions || parent.extensions ? { ...parent.extensions, ...patch.extensions } : undefined
  const defaultMode = patch.defaultMode ?? parent.defaultMode
  // `targets` — по пакету: наследник, назвавший новый пакет, не теряет цель унаследованного раздела.
  const targets = patch.targets || parent.targets ? { ...parent.targets, ...patch.targets } : undefined
  const components = mergeComponents(parent.components, patch.components)
  return {
    id: meta.id,
    title: meta.title,
    ...(meta.description !== undefined ? { description: meta.description } : {}),
    ...(meta.docs !== undefined ? { docs: meta.docs } : {}),
    root: { ...parent.root, ...patch.root },
    modes,
    ...(defaultMode !== undefined ? { defaultMode } : {}),
    ...(baseCss !== undefined ? { baseCss } : {}),
    ...(extensions !== undefined ? { extensions } : {}),
    ...(patch.version !== undefined ? { version: patch.version } : {}),
    ...(targets !== undefined ? { targets } : {}),
    ...(components !== undefined ? { components } : {}),
  }
}

/**
 * Значения раздела `components`, слитые в `root`/`modes` темы: так их видят
 * слои значений (T-7) и читатель `dist` до 3.10 (C-44). Раздел остаётся —
 * индексом принадлежности.
 */
export function flattenThemeComponents(data: GranumThemeData): GranumThemeData {
  if (data.components === undefined)
    return data
  const root: Record<string, string> = { ...data.root }
  const modes: Record<string, GranumModeData> = {}
  for (const [name, mode] of Object.entries(data.modes))
    modes[name] = { ...mode, tokens: { ...mode.tokens } }
  for (const byComponent of Object.values(data.components)) {
    for (const values of Object.values(byComponent)) {
      Object.assign(root, values.root)
      for (const [mode, tokens] of Object.entries(values.modes ?? {})) {
        if (modes[mode])
          modes[mode] = { ...modes[mode], tokens: { ...modes[mode].tokens, ...tokens } }
      }
    }
  }
  return { ...data, root, modes }
}

/**
 * Обратное к {@link flattenThemeComponents}: данные `dist` разводятся по месту —
 * из `root`/`modes` уходят копии значений раздела: тот же токен на том же месте с
 * тем же значением (C-44). Копия с другим значением остаётся — её назовёт проверка
 * коллизий. Нужно до слияния с потомком: иначе каждый токен раздела родителя дал бы
 * коллизию.
 */
export function unflattenThemeComponents(data: GranumThemeData): GranumThemeData {
  if (data.components === undefined)
    return data
  const rootCopies = new Map<string, string>()
  const modeCopies = new Map<string, Map<string, string>>()
  for (const byComponent of Object.values(data.components)) {
    for (const values of Object.values(byComponent)) {
      for (const [token, value] of Object.entries(values.root ?? {}))
        rootCopies.set(token, value)
      for (const [mode, tokens] of Object.entries(values.modes ?? {})) {
        const copies = modeCopies.get(mode) ?? new Map<string, string>()
        for (const [token, value] of Object.entries(tokens))
          copies.set(token, value)
        modeCopies.set(mode, copies)
      }
    }
  }
  const isCopy = (copies: ReadonlyMap<string, string> | undefined, token: string, value: string): boolean => copies?.get(token) === value
  const root = Object.fromEntries(Object.entries(data.root).filter(([token, value]) => !isCopy(rootCopies, token, value)))
  const modes: Record<string, GranumModeData> = {}
  for (const [name, mode] of Object.entries(data.modes)) {
    const copies = modeCopies.get(name)
    modes[name] = copies ? { ...mode, tokens: Object.fromEntries(Object.entries(mode.tokens).filter(([token, value]) => !isCopy(copies, token, value))) } : mode
  }
  return { ...data, root, modes }
}

export type TokenNature = 'root' | 'mode'

/**
 * Полнота темы по реестру: токен `root` — в `root`, токен `mode` — в
 * итоговых токенах каждого режима. Возвращает недостающее как `<где>:<токен>`
 * (`root:xh-radius`, `dark:xh-bg`), отсортированным.
 */
export function missingRegistryTokens(data: GranumThemeData, registry: Readonly<Record<string, TokenNature>>): string[] {
  const missing: string[] = []
  const resolved = Object.fromEntries(Object.keys(data.modes).map(mode => [mode, modeTokens(data, mode)]))
  for (const [token, nature] of Object.entries(registry)) {
    if (nature === 'root') {
      if (!Object.hasOwn(data.root, token))
        missing.push(`root:${token}`)
      continue
    }
    for (const [mode, tokens] of Object.entries(resolved)) {
      if (!Object.hasOwn(tokens, token))
        missing.push(`${mode}:${token}`)
    }
  }
  return missing.sort()
}

/** Все токены темы без `--`: корень, режимы, фолбэки, раздел `components`. */
export function themeTokenNames(data: GranumThemeData): string[] {
  const names = new Set(Object.keys(data.root))
  for (const byComponent of Object.values(data.components ?? {})) {
    for (const values of Object.values(byComponent)) {
      for (const token of Object.keys(values.root ?? {}))
        names.add(token)
      for (const tokens of Object.values(values.modes ?? {})) {
        for (const token of Object.keys(tokens))
          names.add(token)
      }
    }
  }
  for (const mode of Object.values(data.modes)) {
    for (const token of Object.keys(mode.tokens))
      names.add(token)
    for (const fallback of mode.fallbacks ?? []) {
      for (const token of Object.keys(fallback.tokens))
        names.add(token)
    }
  }
  return [...names].sort()
}
