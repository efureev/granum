/**
 * Рантайм-проверка формы `granum.config`: типы ловят большинство, но
 * конфиг часто пишут в JS. Ошибка называет путь до поля.
 */
import type { GranumAppSources, GranumConfig, GranumCssOptions, GranumJsOptions, GranumPruneTokensOptions, GranumReportOptions } from '../config'
import type { GranumModeData, GranumModeFallback, GranumTokenRef } from '../contract'
import type { GranumActivation, GranumAppTheme, GranumModeDefinition, GranumThemeEntry, GranumThemeModes } from '../core/resolveThemes'
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

const ROOT_KEYS = keysOf<GranumConfig>()(['providers', 'components', 'themes', 'activation', 'engine', 'css', 'appSources', 'pruneTokens', 'js', 'report'])
const APP_THEME_KEYS = keysOf<GranumAppTheme>()(['id', 'title', 'description', 'docs', 'root', 'modes', 'defaultMode', 'baseCss', 'extensions', 'extends', 'sources'])
const THEME_ENTRY_KEYS = keysOf<GranumThemeEntry>()(['theme', 'default', 'modes'])
const THEME_MODES_KEYS = keysOf<GranumThemeModes>()(['names', 'define', 'tokenOverrides', 'strictTokens'])
const MODE_DEFINITION_KEYS = keysOf<GranumModeDefinition>()(['extends', 'tokens', 'tokensRef', 'title', 'colorScheme', 'fallbacks'])
const MODE_DATA_KEYS = keysOf<GranumModeData>()(['title', 'colorScheme', 'extends', 'tokens', 'fallbacks'])
const FALLBACK_KEYS = keysOf<GranumModeFallback>()(['supports', 'tokens'])
const ACTIVATION_KEYS = keysOf<GranumActivation>()(['attribute', 'value', 'system'])
const TOKEN_REF_KEYS = keysOf<GranumTokenRef>()(['url', 'selector', 'strict'])
const CSS_KEYS = keysOf<GranumCssOptions>()(['layers', 'layerPrefix', 'split'])
const APP_SOURCES_KEYS = keysOf<GranumAppSources>()(['dirs', 'extensions'])
const PRUNE_TOKENS_KEYS = keysOf<GranumPruneTokensOptions>()(['mode', 'keep', 'keepPrefixes'])
const JS_KEYS = keysOf<GranumJsOptions>()(['dts', 'guard'])
const REPORT_KEYS = keysOf<GranumReportOptions>()(['file', 'brotli'])

const V1_SCAN = `granum does not scan files for package classes: they come from provider manifests; application sources go to 'appSources'`
const ENGINE_RULES = `application rules go to the engine factory, e.g. windEngine({ rules }) from '@feugene/granum-engine-wind'`
const THEMES_LIST = `the build themes are listed in 'themes': themes: ['slate'] or [{ theme: 'slate', default: true, modes: ['light', 'dark'] }, 'clay']`
/** Ключи `themes.*` granum 2 → их место сейчас. */
const THEMES_V2_KEYS: Readonly<Record<string, string>> = {
  names: 'themes[i].modes.names',
  define: 'themes[i].modes.define',
  tokenOverrides: 'themes[i].modes.tokenOverrides',
  strictTokens: 'themes[i].modes.strictTokens',
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
  'theme': `replaced in granum 3.8 — ${THEMES_LIST}`,
  'previews': `replaced in granum 3.8 — list them in 'themes': every theme but the default one gets its own sheet (virtual:granum/themes/<id>.css)`,
  'modes': `moved in granum 3.8 — names, define, tokenOverrides and strictTokens go to 'modes' of the theme's entry in 'themes'; activation and system go to 'activation'`,
  'css.previews': `removed in granum 3.8: an additional theme always has its own sheet (virtual:granum/themes/<id>.css), and the default theme is in the main sheet`,
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

/** Тема-объект приложения: полные данные плюс `extends` и `sources`. */
function validateAppTheme(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (value.trim().length === 0)
      throw new InvalidConfigError(path, 'expected a theme id or a theme object')
    return
  }
  if (!isRecord(value))
    throw new InvalidConfigError(path, `expected a theme id or a theme object, got ${typeof value}`)
  rejectUnknownKeys(value, APP_THEME_KEYS, path)
  // Ключи режима и его фолбэков: опечатка молча выбросила бы значения из CSS.
  // Форму значений проверяет `checkThemeData`, здесь — только имена ключей.
  if (isRecord(value.modes)) {
    for (const [name, mode] of Object.entries(value.modes)) {
      if (!isRecord(mode))
        continue
      rejectUnknownKeys(mode, MODE_DATA_KEYS, `${path}.modes.${name}`)
      if (!Array.isArray(mode.fallbacks))
        continue
      for (const [i, fallback] of mode.fallbacks.entries()) {
        if (isRecord(fallback))
          rejectUnknownKeys(fallback, FALLBACK_KEYS, `${path}.modes.${name}.fallbacks.${i}`)
      }
    }
  }
  const { extends: base, sources, ...data } = value
  if (base !== undefined && (typeof base !== 'string' || base.length === 0))
    throw new InvalidConfigError(`${path}.extends`, 'expected the id of a catalog theme whose component tokens this theme builds on')
  if (sources !== undefined && (!Array.isArray(sources) || !sources.every(file => typeof file === 'string')))
    throw new InvalidConfigError(`${path}.sources`, 'expected an array of file paths')
  const issue = checkThemeData(data)
  if (issue)
    throw new InvalidConfigError(issue.path ? `${path}.${issue.path}` : path, issue.details)
}

/** Режимы записи темы: имена списком или объект `{ names, define, tokenOverrides, strictTokens }`. */
function validateThemeModes(modes: unknown, path: string): void {
  if (modes === undefined)
    return
  if (Array.isArray(modes)) {
    if (!modes.every(name => typeof name === 'string'))
      throw new InvalidConfigError(path, 'expected an array of mode names')
    return
  }
  assertSection(modes, THEME_MODES_KEYS, path)
  if (modes.names !== undefined && (!Array.isArray(modes.names) || !modes.names.every(name => typeof name === 'string')))
    throw new InvalidConfigError(`${path}.names`, 'expected an array of mode names')
  if (modes.define !== undefined && !isRecord(modes.define))
    throw new InvalidConfigError(`${path}.define`, 'expected an object')
  // Имена токенов пишутся без `--` — префикс добавляет генератор.
  // Ключ с ним уехал бы в CSS как `----имя` и не действовал бы молча.
  for (const [name, definition] of Object.entries(modes.define ?? {})) {
    const at = `${path}.define.${name}`
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
      if ('as' in ref)
        throw new InvalidConfigError(`${at}.tokensRef.as`, `unknown option — removed: the tokens of a defined mode are emitted under its pair '<theme>-${name}' set by activation; 'as' has had no effect since granum 3.0`)
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
        rejectUnknownKeys(fallback, FALLBACK_KEYS, where)
        rejectPrefixedTokens(fallback.tokens, `${where}.tokens`)
      }
    }
  }
  if (modes.tokenOverrides !== undefined && !isRecord(modes.tokenOverrides))
    throw new InvalidConfigError(`${path}.tokenOverrides`, 'expected an object: root and mode names → token values')
  // Значение режима — объект токенов: строка разошлась бы на `--0`, `--1`, …
  for (const [scope, overrides] of Object.entries(modes.tokenOverrides ?? {})) {
    if (!isRecord(overrides))
      throw new InvalidConfigError(`${path}.tokenOverrides.${scope}`, 'expected an object of token values')
    rejectPrefixedTokens(overrides, `${path}.tokenOverrides.${scope}`)
    for (const [token, value] of Object.entries(overrides)) {
      if (typeof value !== 'string')
        throw new InvalidConfigError(`${path}.tokenOverrides.${scope}.${token}`, 'expected a string value')
    }
  }
  if (modes.strictTokens !== undefined && typeof modes.strictTokens !== 'boolean')
    throw new InvalidConfigError(`${path}.strictTokens`, 'expected a boolean')
}

/** Запись `themes` в полной форме — объект с ключом `theme`; иначе это сама тема. */
function isThemeEntry(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && 'theme' in value
}

/**
 * Темы сборки: список записей с ровно одной основной. Ошибка отметки — формы, а
 * не резолюции: какая тема основная, видно из самого конфига.
 */
function validateThemes(themes: unknown): void {
  if (themes === undefined)
    return
  if (!Array.isArray(themes)) {
    const key = isRecord(themes) ? Object.keys(themes).find(k => Object.hasOwn(THEMES_V2_KEYS, k)) : undefined
    if (key !== undefined)
      throw new InvalidConfigError(`themes.${key}`, `removed in granum 3 — use '${THEMES_V2_KEYS[key]}'; ${THEMES_LIST}`)
    throw new InvalidConfigError('themes', `expected an array — ${THEMES_LIST}`)
  }
  if (themes.length === 0)
    throw new InvalidConfigError('themes', `expected at least one theme — omit 'themes' to build the default theme of the catalog`)
  for (const [i, entry] of themes.entries()) {
    const path = `themes.${i}`
    if (!isThemeEntry(entry)) {
      validateAppTheme(entry, path)
      continue
    }
    rejectUnknownKeys(entry, THEME_ENTRY_KEYS, path)
    validateAppTheme(entry.theme, `${path}.theme`)
    if (entry.default !== undefined && typeof entry.default !== 'boolean')
      throw new InvalidConfigError(`${path}.default`, 'expected a boolean')
    validateThemeModes(entry.modes, `${path}.modes`)
  }
  if (themes.length > 1) {
    const marked = themes.flatMap((entry, i) => (isThemeEntry(entry) && entry.default === true ? [i] : []))
    if (marked.length !== 1) {
      throw new InvalidConfigError(
        'themes',
        marked.length === 0
          ? `${themes.length} themes and none is marked 'default: true' — mark the one that goes under ':root' and into the main sheet`
          : `${marked.length} themes are marked 'default: true' (themes.${marked.join(', themes.')}) — exactly one goes under ':root'`,
      )
    }
  }
}

function validateActivation(activation: unknown): void {
  assertSection(activation, ACTIVATION_KEYS, 'activation')
  if (activation?.attribute !== undefined && !/^[a-z][\w-]*$/i.test(String(activation.attribute)))
    throw new InvalidConfigError('activation.attribute', 'expected an attribute name')
  if (activation?.value !== undefined && typeof activation.value !== 'string')
    throw new InvalidConfigError('activation.value', `expected a template with '{theme}' and '{mode}'`)
  if (activation?.system !== undefined && activation.system !== 'none' && activation.system !== 'media')
    throw new InvalidConfigError('activation.system', `expected 'none' or 'media'`)
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
  validateThemes(config.themes)
  validateActivation(config.activation)
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
