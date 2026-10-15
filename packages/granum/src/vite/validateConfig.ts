/**
 * Рантайм-проверка формы `granum.config` (A-1): типы ловят большинство, но
 * конфиг часто пишут в JS. Ошибка называет путь до поля.
 */
import type { GranumAppSources, GranumConfig, GranumCssOptions, GranumJsOptions, GranumPruneTokensOptions, GranumReportOptions } from '../config'
import type { GranumTokenRef } from '../contract'
import type { GranumThemesInput } from '../core/resolve'
import type { GranumAppThemeDefinition } from '../core/resolveThemes'
import { GranumError } from '../core/errors'
import { isDialect } from '../engine/dialect'

export class InvalidConfigError extends GranumError {
  readonly code = 'invalid-config' as const

  constructor(readonly path: string, details: string) {
    super(`Invalid granum config at '${path}': ${details}`)
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Ключи типа списком, сверенным с типом в обе стороны: чужой ключ не пройдёт
 * ограничение `keyof T`, пропущенный — потребует свойство `missing`. Новое поле
 * конфига без строки здесь — ошибка `yarn typecheck`, а не ключ, который проверка
 * формы молча отвергнет.
 */
function keysOf<T>() {
  return <const K extends readonly (keyof T & string)[]>(
    keys: K & ([Exclude<keyof T, K[number]>] extends [never] ? unknown : { missing: Exclude<keyof T, K[number]> }),
  ): readonly string[] => keys
}

const ROOT_KEYS = keysOf<GranumConfig>()(['providers', 'components', 'themes', 'engine', 'css', 'appSources', 'pruneTokens', 'js', 'report'])
const THEMES_KEYS = keysOf<GranumThemesInput>()(['names', 'define', 'tokenOverrides', 'strictTokens'])
const THEME_DEFINITION_KEYS = keysOf<GranumAppThemeDefinition>()(['extends', 'selector', 'tokens', 'tokensRef', 'label', 'colorScheme'])
const TOKEN_REF_KEYS = keysOf<GranumTokenRef>()(['url', 'selector', 'as', 'strict'])
const CSS_KEYS = keysOf<GranumCssOptions>()(['layers', 'layerPrefix', 'split'])
const APP_SOURCES_KEYS = keysOf<GranumAppSources>()(['dirs', 'extensions'])
const PRUNE_TOKENS_KEYS = keysOf<GranumPruneTokensOptions>()(['mode', 'keep', 'keepPrefixes'])
const JS_KEYS = keysOf<GranumJsOptions>()(['dts', 'guard'])
const REPORT_KEYS = keysOf<GranumReportOptions>()(['file', 'brotli'])

const V1_SCAN = `granum does not scan files for package classes: they come from provider manifests; application sources go to 'appSources'`
const ENGINE_RULES = `application rules go to the engine factory, e.g. windEngine({ rules }) from '@feugene/granum-engine-wind'`
const THEME_FILES = `a provider file cannot be swapped: change theme values with 'themes.tokenOverrides' or a whole theme with 'themes.define.<name>.tokensRef'`

/**
 * Ключи, которых в конфиге нет, но которые пишут по памяти: пресет v1 и опции,
 * удалённые в 2.0. Вместо «неизвестный ключ» — куда он делся.
 */
const KEY_HINTS: Readonly<Record<string, string>> = {
  'scan': V1_SCAN,
  'content': V1_SCAN,
  'unocss': ENGINE_RULES,
  'rules': ENGINE_RULES,
  'variants': ENGINE_RULES,
  'preflights': ENGINE_RULES,
  'themes.themeFiles': THEME_FILES,
  'themes.baseFile': THEME_FILES,
  'themes.tokensFile': THEME_FILES,
  'pruneTokens.appSources': `moved to the top-level 'appSources': it also feeds the extraction of application classes`,
  'js.virtualComponents': `removed: virtual:granum/components is built only when the application imports it; to forbid the import, use ESLint no-restricted-imports`,
  'css.expandDirectives': `removed: @apply is expanded by the provider build (granumProvider()), and granum doctor reports what is left (apply-not-expanded)`,
}

/** Расстояние Левенштейна — для подсказки при опечатке в ключе. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }
  return previous[b.length]!
}

/**
 * Неизвестный ключ уровня — ошибка с путём до него: опечатка или ключ v1 иначе
 * молча не действует (`appSource` — и классы разметки не генерируются).
 */
function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key))
      continue
    const full = path ? `${path}.${key}` : key
    const near = allowed
      .map(candidate => ({ candidate, distance: editDistance(key.toLowerCase(), candidate.toLowerCase()) }))
      .filter(({ distance }) => distance <= 2)
      .sort((a, b) => a.distance - b.distance)[0]
      ?.candidate
    const details = KEY_HINTS[full]
      ?? (near !== undefined ? `did you mean '${near}'?` : `expected one of: ${allowed.join(', ')}`)
    throw new InvalidConfigError(full, `unknown option — ${details}`)
  }
}

/** Необязательный раздел конфига: если задан — объект с известными ключами. */
function assertSection(value: unknown, allowed: readonly string[], path: string): asserts value is Record<string, unknown> | undefined {
  if (value === undefined)
    return
  if (!isRecord(value))
    throw new InvalidConfigError(path, 'expected an object')
  rejectUnknownKeys(value, allowed, path)
}

/** Строковые значения записи — токены; ключ с `--` среди них — ошибка формы. */
function rejectPrefixedTokens(tokens: Record<string, unknown>, path: string): void {
  for (const [key, value] of Object.entries(tokens)) {
    if (typeof value === 'string' && key.startsWith('--'))
      throw new InvalidConfigError(path, `token key '${key}' must not start with '--' — the generator adds it`)
  }
}

/**
 * Движок — обязательный инстанс (A-E1, A-E2). Проверяется форма, а не
 * реализация: имя словаря и его отпечаток нужны для решений, `extract` и
 * `generate` — для работы. Без отпечатка granum не смог бы решить, верить ли
 * списку классов манифеста, и молча поверил бы — ровно то, чего нельзя.
 */
function validateEngine(engine: unknown): void {
  if (engine === undefined || engine === null) {
    throw new InvalidConfigError(
      'engine',
      `expected a GranumEngine instance — e.g. windEngine() from '@feugene/granum-engine-wind'. `
      + `The application picks the engine: granum ships no implementation.`,
    )
  }
  if (typeof engine === 'string')
    throw new InvalidConfigError('engine', `expected a GranumEngine instance, got the string ${JSON.stringify(engine)} — pass the engine itself`)
  if (!isRecord(engine))
    throw new InvalidConfigError('engine', `expected a GranumEngine instance, got ${typeof engine}`)
  for (const method of ['extract', 'generate'] as const) {
    if (typeof engine[method] !== 'function')
      throw new InvalidConfigError(`engine.${method}`, 'expected a function')
  }
  if (typeof engine.name !== 'string' || engine.name.length === 0)
    throw new InvalidConfigError('engine.name', 'expected a non-empty string naming the implementation')
  if (!isDialect(engine.dialect))
    throw new InvalidConfigError('engine.dialect', `expected '<vendor>/<vocabulary>@<major>', got ${JSON.stringify(engine.dialect)}`)
  if (typeof engine.vocabulary !== 'string' || engine.vocabulary.length === 0)
    throw new InvalidConfigError('engine.vocabulary', 'expected a non-empty fingerprint of the generated name set (vocabularyFingerprint)')
}

export function validateGranumConfig(config: unknown): asserts config is GranumConfig {
  if (!isRecord(config))
    throw new InvalidConfigError('', 'expected an object')
  rejectUnknownKeys(config, ROOT_KEYS, '')
  if (!Array.isArray(config.providers) || config.providers.length === 0)
    throw new InvalidConfigError('providers', 'expected a non-empty array of package names, provider objects or loaded manifests')
  config.providers.forEach((p, i) => {
    if (typeof p === 'string' ? p.trim().length === 0 : !isRecord(p))
      throw new InvalidConfigError(`providers.${i}`, 'expected a package name or an object')
  })
  validateEngine(config.engine)
  const c = config.components
  if (c !== undefined && c !== 'all' && c !== 'imports' && !Array.isArray(c))
    throw new InvalidConfigError('components', `expected 'all', 'imports' or an array, got ${typeof c}`)
  const themes = config.themes
  if (themes !== undefined) {
    if (!isRecord(themes))
      throw new InvalidConfigError('themes', 'expected an object')
    rejectUnknownKeys(themes, THEMES_KEYS, 'themes')
    if (themes.names !== undefined && !Array.isArray(themes.names))
      throw new InvalidConfigError('themes.names', 'expected an array of theme names')
    if (themes.define !== undefined && !isRecord(themes.define))
      throw new InvalidConfigError('themes.define', 'expected an object')
    if (themes.tokenOverrides !== undefined && !isRecord(themes.tokenOverrides))
      throw new InvalidConfigError('themes.tokenOverrides', 'expected an object')
    // Имена токенов пишутся без `--` — префикс добавляет генератор.
    // Ключ с ним уехал бы в CSS как `----имя` и не действовал бы молча.
    for (const [theme, definition] of Object.entries(themes.define ?? {})) {
      if (!isRecord(definition))
        throw new InvalidConfigError(`themes.define.${theme}`, 'expected an object')
      rejectUnknownKeys(definition, THEME_DEFINITION_KEYS, `themes.define.${theme}`)
      const ref = definition.tokensRef
      if (ref !== undefined && typeof ref !== 'string') {
        if (!isRecord(ref))
          throw new InvalidConfigError(`themes.define.${theme}.tokensRef`, `expected a CSS URL or { url, selector?, as?, strict? }`)
        rejectUnknownKeys(ref, TOKEN_REF_KEYS, `themes.define.${theme}.tokensRef`)
      }
      if (isRecord(definition.tokens))
        rejectPrefixedTokens(definition.tokens, `themes.define.${theme}.tokens`)
    }
    // Значение темы — объект токенов: строка разошлась бы на `--0`, `--1`, …
    for (const [theme, overrides] of Object.entries(themes.tokenOverrides ?? {})) {
      if (!isRecord(overrides))
        throw new InvalidConfigError(`themes.tokenOverrides.${theme}`, 'expected an object of token values or selector blocks')
      rejectPrefixedTokens(overrides, `themes.tokenOverrides.${theme}`)
      for (const value of Object.values(overrides)) {
        if (isRecord(value))
          rejectPrefixedTokens(value, `themes.tokenOverrides.${theme}`)
      }
    }
  }
  const prune = config.pruneTokens
  assertSection(prune, PRUNE_TOKENS_KEYS, 'pruneTokens')
  if (prune?.mode !== undefined && !['off', 'report', 'on'].includes(prune.mode as string))
    throw new InvalidConfigError('pruneTokens.mode', `expected 'off', 'report' or 'on', got ${JSON.stringify(prune.mode)}`)
  const sources = config.appSources
  if (isRecord(sources))
    rejectUnknownKeys(sources, APP_SOURCES_KEYS, 'appSources')
  if (sources !== undefined && (!isRecord(sources) || !Array.isArray(sources.dirs)))
    throw new InvalidConfigError('appSources', 'expected { dirs: string[] }')
  if (c === 'imports' && sources === undefined)
    throw new InvalidConfigError('components', `'imports' requires appSources.dirs to scan`)
  const js = config.js
  assertSection(js, JS_KEYS, 'js')
  if (js?.guard !== undefined && !['error', 'warn', 'off'].includes(js.guard as string))
    throw new InvalidConfigError('js.guard', `expected 'error', 'warn' or 'off'`)
  const css = config.css
  assertSection(css, CSS_KEYS, 'css')
  if (css?.layerPrefix !== undefined && !/^[a-z][\w-]*$/i.test(String(css.layerPrefix)))
    throw new InvalidConfigError('css.layerPrefix', 'expected an identifier')
  assertSection(config.report, REPORT_KEYS, 'report')
}
