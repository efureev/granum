/**
 * Рантайм-проверка формы `granum.config`: типы ловят большинство, но
 * конфиг часто пишут в JS. Ошибка называет путь до поля.
 */
import type { GranumAppSources, GranumConfig, GranumCssOptions, GranumJsOptions, GranumPruneTokensOptions, GranumReportOptions } from '../config'
import type { GranumTokenRef } from '../contract'
import type { GranumAppTheme, GranumModeActivation, GranumModeDefinition, GranumModesInput } from '../core/resolveThemes'
import { GranumError } from '../core/errors'
import { checkThemeData, isModeName } from '../core/themeData'
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

const ROOT_KEYS = keysOf<GranumConfig>()(['providers', 'components', 'theme', 'previews', 'modes', 'engine', 'css', 'appSources', 'pruneTokens', 'js', 'report'])
const APP_THEME_KEYS = keysOf<GranumAppTheme>()(['id', 'title', 'description', 'docs', 'root', 'modes', 'defaultMode', 'baseCss', 'extensions', 'extends', 'sources'])
const MODES_KEYS = keysOf<GranumModesInput>()(['names', 'define', 'activation', 'tokenOverrides', 'strictTokens', 'system'])
const MODE_DEFINITION_KEYS = keysOf<GranumModeDefinition>()(['extends', 'tokens', 'tokensRef', 'title', 'colorScheme', 'fallbacks'])
const ACTIVATION_KEYS = keysOf<GranumModeActivation>()(['attribute', 'value'])
const TOKEN_REF_KEYS = keysOf<GranumTokenRef>()(['url', 'selector', 'as', 'strict'])
const CSS_KEYS = keysOf<GranumCssOptions>()(['layers', 'layerPrefix', 'split'])
const APP_SOURCES_KEYS = keysOf<GranumAppSources>()(['dirs', 'extensions'])
const PRUNE_TOKENS_KEYS = keysOf<GranumPruneTokensOptions>()(['mode', 'keep', 'keepPrefixes'])
const JS_KEYS = keysOf<GranumJsOptions>()(['dts', 'guard'])
const REPORT_KEYS = keysOf<GranumReportOptions>()(['file', 'brotli'])

const V1_SCAN = `granum does not scan files for package classes: they come from provider manifests; application sources go to 'appSources'`
const ENGINE_RULES = `application rules go to the engine factory, e.g. windEngine({ rules }) from '@feugene/granum-engine-wind'`
const THEMES_V2 = `removed in granum 3: the build has one theme ('theme') and its modes ('modes') — `
  + `themes.names → modes.names, themes.define → modes.define, themes.tokenOverrides → modes.tokenOverrides, themes.strictTokens → modes.strictTokens`
/** Ключи `themes.*` granum 2 → их место в 3 (A-30). */
const THEMES_V2_KEYS: Readonly<Record<string, string>> = {
  names: 'modes.names',
  define: 'modes.define',
  tokenOverrides: 'modes.tokenOverrides',
  strictTokens: 'modes.strictTokens',
}

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
  'themes': THEMES_V2,
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
 * Движок — обязательный инстанс. Проверяется форма, а не
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

/** Тема-объект приложения: полные данные (C-24…C-26) плюс `extends` и `sources`. */
function validateAppTheme(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (value.trim().length === 0)
      throw new InvalidConfigError(path, 'expected a theme id or a theme object')
    return
  }
  if (!isRecord(value))
    throw new InvalidConfigError(path, `expected a theme id or a theme object, got ${typeof value}`)
  rejectUnknownKeys(value, APP_THEME_KEYS, path)
  const { extends: base, sources, ...data } = value
  if (base !== undefined && (typeof base !== 'string' || base.length === 0))
    throw new InvalidConfigError(`${path}.extends`, 'expected the id of a catalog theme whose component tokens this theme builds on')
  if (sources !== undefined && (!Array.isArray(sources) || !sources.every(file => typeof file === 'string')))
    throw new InvalidConfigError(`${path}.sources`, 'expected an array of file paths')
  const issue = checkThemeData(data)
  if (issue)
    throw new InvalidConfigError(issue.path ? `${path}.${issue.path}` : path, issue.details)
}

function validateModes(modes: unknown): void {
  assertSection(modes, MODES_KEYS, 'modes')
  if (modes === undefined)
    return
  if (modes.names !== undefined && (!Array.isArray(modes.names) || !modes.names.every(name => typeof name === 'string')))
    throw new InvalidConfigError('modes.names', 'expected an array of mode names')
  if (modes.define !== undefined && !isRecord(modes.define))
    throw new InvalidConfigError('modes.define', 'expected an object')
  // Имена токенов пишутся без `--` — префикс добавляет генератор.
  // Ключ с ним уехал бы в CSS как `----имя` и не действовал бы молча.
  for (const [name, definition] of Object.entries(modes.define ?? {})) {
    const at = `modes.define.${name}`
    if (!isModeName(name))
      throw new InvalidConfigError(at, `mode name must match /^[a-z][a-z0-9]*$/ and not be 'root': it becomes the end of the pair '<theme>-${name}'`)
    if (!isRecord(definition))
      throw new InvalidConfigError(at, 'expected an object')
    rejectUnknownKeys(definition, MODE_DEFINITION_KEYS, at)
    if (typeof definition.extends !== 'string' || definition.extends.length === 0)
      throw new InvalidConfigError(`${at}.extends`, 'expected the name of a theme mode or another defined mode')
    if (definition.colorScheme !== undefined && definition.colorScheme !== 'light' && definition.colorScheme !== 'dark')
      throw new InvalidConfigError(`${at}.colorScheme`, `expected 'light' or 'dark'`)
    const ref = definition.tokensRef
    if (ref !== undefined && typeof ref !== 'string') {
      if (!isRecord(ref))
        throw new InvalidConfigError(`${at}.tokensRef`, `expected a CSS URL or { url, selector?, strict? }`)
      rejectUnknownKeys(ref, TOKEN_REF_KEYS, `${at}.tokensRef`)
    }
    if (definition.tokens !== undefined) {
      if (!isRecord(definition.tokens))
        throw new InvalidConfigError(`${at}.tokens`, 'expected an object of token values')
      rejectPrefixedTokens(definition.tokens, `${at}.tokens`)
    }
    if (definition.fallbacks !== undefined) {
      if (!Array.isArray(definition.fallbacks))
        throw new InvalidConfigError(`${at}.fallbacks`, 'expected an array of { supports, tokens }')
      for (const [i, fallback] of definition.fallbacks.entries()) {
        const where = `${at}.fallbacks.${i}`
        if (!isRecord(fallback) || typeof fallback.supports !== 'string' || !isRecord(fallback.tokens))
          throw new InvalidConfigError(where, 'expected { supports: string, tokens: { … } }')
        rejectUnknownKeys(fallback, ['supports', 'tokens'], where)
        rejectPrefixedTokens(fallback.tokens, `${where}.tokens`)
      }
    }
  }
  const activation = modes.activation
  assertSection(activation, ACTIVATION_KEYS, 'modes.activation')
  if (activation?.attribute !== undefined && !/^[a-z][\w-]*$/i.test(String(activation.attribute)))
    throw new InvalidConfigError('modes.activation.attribute', 'expected an attribute name')
  if (activation?.value !== undefined && typeof activation.value !== 'string')
    throw new InvalidConfigError('modes.activation.value', `expected a template with '{theme}' and '{mode}'`)
  if (modes.tokenOverrides !== undefined && !isRecord(modes.tokenOverrides))
    throw new InvalidConfigError('modes.tokenOverrides', 'expected an object: root and mode names → token values')
  // Значение режима — объект токенов: строка разошлась бы на `--0`, `--1`, …
  for (const [scope, overrides] of Object.entries(modes.tokenOverrides ?? {})) {
    if (!isRecord(overrides))
      throw new InvalidConfigError(`modes.tokenOverrides.${scope}`, 'expected an object of token values')
    rejectPrefixedTokens(overrides, `modes.tokenOverrides.${scope}`)
    for (const [token, value] of Object.entries(overrides)) {
      if (typeof value !== 'string')
        throw new InvalidConfigError(`modes.tokenOverrides.${scope}.${token}`, 'expected a string value')
    }
  }
  if (modes.strictTokens !== undefined && typeof modes.strictTokens !== 'boolean')
    throw new InvalidConfigError('modes.strictTokens', 'expected a boolean')
  if (modes.system !== undefined && modes.system !== 'none' && modes.system !== 'media')
    throw new InvalidConfigError('modes.system', `expected 'none' or 'media'`)
}

export function validateGranumConfig(config: unknown): asserts config is GranumConfig {
  if (!isRecord(config))
    throw new InvalidConfigError('', 'expected an object')
  // Ключи `themes.*` granum 2 — по одному, с их новым местом (A-30).
  if (isRecord(config.themes)) {
    const key = Object.keys(config.themes).find(k => Object.hasOwn(THEMES_V2_KEYS, k))
    if (key !== undefined)
      throw new InvalidConfigError(`themes.${key}`, `removed in granum 3 — use '${THEMES_V2_KEYS[key]}'; the theme itself is chosen with 'theme'`)
  }
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
  if (config.theme !== undefined)
    validateAppTheme(config.theme, 'theme')
  if (config.previews !== undefined) {
    if (!Array.isArray(config.previews))
      throw new InvalidConfigError('previews', 'expected an array of theme ids or theme objects')
    config.previews.forEach((preview, i) => validateAppTheme(preview, `previews.${i}`))
  }
  validateModes(config.modes)
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
