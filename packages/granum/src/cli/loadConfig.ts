/**
 * Загрузка `granum.config.*` для CLI (D-4). TS-конфиг: через `vite`
 * (`loadConfigFromFile`), если он резолвится из корня приложения, иначе
 * нативный `import()` (Node ≥ 22.18 снимает типы сам). Экспорт — `default`,
 * `granum` или `config`.
 */
import type { GranumConfig } from '../config'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GranumError } from '../core/errors'
import { validateGranumConfig } from '../vite/validateConfig'

export class ConfigLoadError extends GranumError {
  readonly code = 'config-load' as const

  constructor(readonly file: string, details: string, options?: { cause?: unknown }) {
    super(`Cannot load granum config '${file}': ${details}`, options)
  }
}

export interface LoadedGranumConfig {
  readonly config: GranumConfig
  readonly file: string
  readonly root: string
}

function pick(mod: Record<string, unknown>): unknown {
  return mod.default ?? mod.granum ?? mod.config
}

async function importViaVite(file: string, root: string): Promise<unknown> {
  const require = createRequire(resolve(root, 'package.json'))
  let vitePath: string
  try {
    vitePath = require.resolve('vite')
  }
  catch {
    return undefined
  }
  const vite = await import(pathToFileURL(vitePath).href) as { loadConfigFromFile?: (env: { command: 'build', mode: string }, file: string, root: string) => Promise<{ config: unknown } | null> }
  if (!vite.loadConfigFromFile)
    return undefined
  const loaded = await vite.loadConfigFromFile({ command: 'build', mode: 'production' }, file, root)
  return loaded?.config
}

export async function loadGranumConfigFile(path: string, cwd: string): Promise<LoadedGranumConfig> {
  const file = resolve(cwd, path)
  const root = dirname(file)
  let raw: unknown
  try {
    if (/\.[cm]?ts$/.test(file))
      raw = await importViaVite(file, root)
    if (raw === undefined)
      raw = pick(await import(pathToFileURL(file).href) as Record<string, unknown>)
  }
  catch (cause) {
    throw new ConfigLoadError(path, (cause as Error).message, { cause })
  }
  if (raw === undefined)
    throw new ConfigLoadError(path, 'the module exports neither default, granum nor config')
  try {
    validateGranumConfig(raw)
  }
  catch (cause) {
    throw new ConfigLoadError(path, (cause as Error).message, { cause })
  }
  return { config: raw, file, root }
}
