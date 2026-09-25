/**
 * Рантайм-проверка формы `granum.config` (A-1): типы ловят большинство, но
 * конфиг часто пишут в JS. Ошибка называет путь до поля.
 */
import type { GranumConfig } from '../config'
import { GranumError } from '../core/errors'

export class InvalidConfigError extends GranumError {
  readonly code = 'invalid-config' as const

  constructor(readonly path: string, details: string) {
    super(`Invalid granum config at '${path}': ${details}`)
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function validateGranumConfig(config: unknown): asserts config is GranumConfig {
  if (!isRecord(config))
    throw new InvalidConfigError('', 'expected an object')
  if (!Array.isArray(config.providers) || config.providers.length === 0)
    throw new InvalidConfigError('providers', 'expected a non-empty array of package names, provider objects or loaded manifests')
  config.providers.forEach((p, i) => {
    if (typeof p === 'string' ? p.trim().length === 0 : !isRecord(p))
      throw new InvalidConfigError(`providers.${i}`, 'expected a package name or an object')
  })
  const c = config.components
  if (c !== undefined && c !== 'all' && c !== 'imports' && !Array.isArray(c))
    throw new InvalidConfigError('components', `expected 'all', 'imports' or an array, got ${typeof c}`)
  const themes = config.themes
  if (themes !== undefined) {
    if (!isRecord(themes))
      throw new InvalidConfigError('themes', 'expected an object')
    if (themes.names !== undefined && !Array.isArray(themes.names))
      throw new InvalidConfigError('themes.names', 'expected an array of theme names')
    if (themes.define !== undefined && !isRecord(themes.define))
      throw new InvalidConfigError('themes.define', 'expected an object')
    if (themes.tokenOverrides !== undefined && !isRecord(themes.tokenOverrides))
      throw new InvalidConfigError('themes.tokenOverrides', 'expected an object')
  }
  const prune = config.pruneTokens
  if (prune !== undefined) {
    if (!isRecord(prune))
      throw new InvalidConfigError('pruneTokens', 'expected an object')
    if (prune.mode !== undefined && !['off', 'report', 'on'].includes(prune.mode as string))
      throw new InvalidConfigError('pruneTokens.mode', `expected 'off', 'report' or 'on', got ${JSON.stringify(prune.mode)}`)
  }
  const sources = config.appSources
  if (sources !== undefined && (!isRecord(sources) || !Array.isArray(sources.dirs)))
    throw new InvalidConfigError('appSources', 'expected { dirs: string[] }')
  if (c === 'imports' && sources === undefined)
    throw new InvalidConfigError('components', `'imports' requires appSources.dirs to scan`)
  const js = config.js
  if (js !== undefined && isRecord(js) && js.guard !== undefined && !['error', 'warn', 'off'].includes(js.guard as string))
    throw new InvalidConfigError('js.guard', `expected 'error', 'warn' or 'off'`)
  const css = config.css
  if (css !== undefined && isRecord(css) && css.layerPrefix !== undefined && !/^[a-z][\w-]*$/i.test(String(css.layerPrefix)))
    throw new InvalidConfigError('css.layerPrefix', 'expected an identifier')
}
