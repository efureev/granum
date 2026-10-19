/**
 * Данные темы (`GranumThemeData`): форма, цепочки режимов, наследование темы
 * от темы и полнота по реестру. Чистые функции — их зовут сборка провайдера
 * (C-24…C-30), чтение данных приложением и проверка темы-объекта в конфиге.
 */
import type { GranumModeData, GranumThemeData } from '../contract/types'

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
export function checkThemeData(raw: unknown, options: { readonly partial?: boolean } = {}): ThemeDataIssue | undefined {
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
  if (partial)
    return undefined
  return checkModeGraph(raw as unknown as GranumThemeData)
}

/** `defaultMode` и цепочки `extends` режимов полной темы (C-25, C-26). */
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

/** Итоговые токены режима: предки по цепочке, затем свои (C-26). */
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
}

/**
 * Тема каталога с `extends` — родитель плюс отличия (C-27). Токены
 * сливаются по ключу, фолбэки режима и `baseCss` отличий заменяют родительские
 * целиком, `extensions` сливаются на верхнем уровне. Метаданные — из `meta`
 * (записи каталога), а не из родителя.
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
  }
}

export type TokenNature = 'root' | 'mode'

/**
 * Полнота темы по реестру (C-30): токен `root` — в `root`, токен `mode` — в
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

/** Все токены темы без `--`: корень, режимы, фолбэки. */
export function themeTokenNames(data: GranumThemeData): string[] {
  const names = new Set(Object.keys(data.root))
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
