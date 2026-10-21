/**
 * Исходник темы (C-42): папка с `theme.json`, `root`, `base.css`, `modes/` и
 * `components/<провайдер>/<Компонент>/`. Читается строго: файл, которого
 * раскладка не знает, — ошибка, а не пропуск: молча пропущенный файл — потерянные
 * значения.
 */
import type { GranumModeData, GranumThemeComponentValues } from '../contract'
import type { GranumAppTheme } from '../core/resolveThemes'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ThemeSourceError } from '../core/errors'
import { checkThemeData, isModeName } from '../core/themeData'
import { parseCssTokenBlocksFromText } from './cssTokens'

export interface LoadThemeSourceOptions {
  /**
   * Файлы и папки исходника, которые не данные темы (заметки дизайн-системы):
   * пути относительно папки, через `/`. Папка исключается целиком.
   */
  readonly ignore?: readonly string[]
}

const THEME_JSON_KEYS = new Set(['id', 'title', 'description', 'docs', 'version', 'targets', 'extends', 'defaultMode', 'modes', 'extensions'])
const MODE_KEYS = new Set(['title', 'colorScheme', 'extends', 'fallbacks'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Ключи с `$` — пояснения автора, не данные. */
function withoutNotes(entry: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith('$')))
}

/** Значимое содержимое папки: без скрытых файлов, `*.md` и того, что исключил автор. */
function entries(dir: string, root: string, ignore: ReadonlySet<string>): string[] {
  if (!statSync(dir).isDirectory())
    throw unexpected(dir, 'expected a folder here')
  return readdirSync(dir).filter((name) => {
    if (name.startsWith('.') || name.toLowerCase().endsWith('.md'))
      return false
    return !ignore.has(relative(root, join(dir, name)).split(sep).join('/'))
  }).sort()
}

function readJson(file: string, reason: 'theme-json-invalid' | 'token-file-invalid'): unknown {
  if (!statSync(file).isFile())
    throw new ThemeSourceError(reason, file, 'expected a file, found a folder')
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  catch (cause) {
    throw new ThemeSourceError(reason, file, `not valid JSON: ${(cause as Error).message}`, { cause })
  }
}

/** Файл значений: JSON `{ "<токен>": "<значение>" }` (ключи с `$` — пояснения) или CSS с одним плоским блоком. */
function readTokenFile(file: string): Record<string, string> {
  let tokens: Record<string, unknown>
  if (file.endsWith('.json')) {
    const raw = readJson(file, 'token-file-invalid')
    if (!isRecord(raw))
      throw new ThemeSourceError('token-file-invalid', file, 'expected an object of "<token>": "<value>" strings')
    tokens = Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith('$')))
  }
  else {
    if (!statSync(file).isFile())
      throw new ThemeSourceError('token-file-invalid', file, 'expected a file, found a folder')
    const { blocks, skipped } = parseCssTokenBlocksFromText(readFileSync(file, 'utf8'))
    if (blocks.length !== 1 || skipped.length > 0)
      throw new ThemeSourceError('token-file-invalid', file, `expected exactly one flat block of custom properties (found ${blocks.length} flat block(s)${skipped.length > 0 ? ` and ${skipped.length} nested or at-rule block(s)` : ''})`)
    tokens = blocks[0]!.tokens
  }
  for (const [token, value] of Object.entries(tokens)) {
    if (typeof value !== 'string')
      throw new ThemeSourceError('token-file-invalid', file, `token '${token}' must have a string value`)
    if (token.startsWith('--'))
      throw new ThemeSourceError('token-file-invalid', file, `token key '${token}' must not start with '--' — the generator adds it`)
  }
  return tokens as Record<string, string>
}

/** `<имя>.json` или `<имя>.css` из списка файлов папки, но не оба. */
function valueFile(dir: string, names: readonly string[], base: string): string | undefined {
  const found = names.filter(name => name === `${base}.json` || name === `${base}.css`)
  if (found.length > 1)
    throw new ThemeSourceError('duplicate-value-file', join(dir, base), `'${base}' is given twice: keep either the .json or the .css file`)
  return found[0] === undefined ? undefined : join(dir, found[0])
}

function unexpected(path: string, expected: string): ThemeSourceError {
  return new ThemeSourceError('unexpected-entry', path, `unexpected entry; ${expected}. List files that are not theme data in 'ignore'`)
}

/** Папка режимов: `<режим>.{json,css}`; каждый режим обязан быть объявлен в `theme.json`. */
function readModesDir(dir: string, root: string, ignore: ReadonlySet<string>, declared: ReadonlySet<string>, files: string[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  const names = entries(dir, root, ignore)
  for (const name of names) {
    const match = /^(.+)\.(?:json|css)$/.exec(name)
    if (!match || !isModeName(match[1]))
      throw unexpected(join(dir, name), 'a modes folder holds <mode>.json or <mode>.css')
    const mode = match[1]!
    if (!declared.has(mode))
      throw new ThemeSourceError('unknown-mode-file', join(dir, name), `mode '${mode}' is not declared in theme.json 'modes' (${[...declared].join(', ') || '—'}); declare it — with an empty entry if it only inherits`)
    if (out[mode] !== undefined)
      continue
    const file = valueFile(dir, names, mode)!
    files.push(file)
    out[mode] = readTokenFile(file)
  }
  return out
}

/** Папка компонента: `root.{json,css}` и `modes/`. */
function readComponentDir(dir: string, root: string, ignore: ReadonlySet<string>, declared: ReadonlySet<string>, files: string[]): GranumThemeComponentValues {
  const names = entries(dir, root, ignore)
  for (const name of names) {
    if (name !== 'root.json' && name !== 'root.css' && name !== 'modes')
      throw unexpected(join(dir, name), 'a component folder holds root.{json,css} and modes/')
  }
  const rootFile = valueFile(dir, names, 'root')
  const modes = names.includes('modes') ? readModesDir(join(dir, 'modes'), root, ignore, declared, files) : {}
  if (rootFile === undefined && Object.keys(modes).length === 0)
    throw new ThemeSourceError('empty-component-dir', dir, 'a component folder without values: remove it or add root or modes files')
  if (rootFile !== undefined)
    files.push(rootFile)
  return {
    ...(rootFile !== undefined ? { root: readTokenFile(rootFile) } : {}),
    ...(Object.keys(modes).length > 0 ? { modes } : {}),
  }
}

/** `components/<провайдер>/<Компонент>/`; провайдер со scope — двумя уровнями (`@acme/ui`). */
function readComponents(dir: string, root: string, ignore: ReadonlySet<string>, declared: ReadonlySet<string>, files: string[]): Record<string, Record<string, GranumThemeComponentValues>> {
  const providers: [string, string][] = []
  for (const name of entries(dir, root, ignore)) {
    const path = join(dir, name)
    if (!statSync(path).isDirectory())
      throw unexpected(path, 'components/ holds a folder per provider package')
    if (!name.startsWith('@')) {
      providers.push([name, path])
      continue
    }
    for (const pkg of entries(path, root, ignore)) {
      if (!statSync(join(path, pkg)).isDirectory())
        throw unexpected(join(path, pkg), 'a scope folder holds a folder per package')
      providers.push([`${name}/${pkg}`, join(path, pkg)])
    }
  }
  const out: Record<string, Record<string, GranumThemeComponentValues>> = {}
  for (const [provider, path] of providers) {
    const byComponent: Record<string, GranumThemeComponentValues> = {}
    for (const component of entries(path, root, ignore)) {
      const componentDir = join(path, component)
      if (!statSync(componentDir).isDirectory())
        throw unexpected(componentDir, 'a provider folder holds a folder per component')
      byComponent[component] = readComponentDir(componentDir, root, ignore, declared, files)
    }
    if (Object.keys(byComponent).length > 0)
      out[provider] = byComponent
  }
  return out
}

function readThemeJson(file: string): Record<string, unknown> {
  if (!existsSync(file))
    throw new ThemeSourceError('theme-json-missing', file, 'a theme source starts with theme.json')
  const raw = readJson(file, 'theme-json-invalid')
  if (!isRecord(raw))
    throw new ThemeSourceError('theme-json-invalid', file, 'expected an object')
  for (const key of Object.keys(raw)) {
    if (!key.startsWith('$') && !THEME_JSON_KEYS.has(key))
      throw new ThemeSourceError('theme-json-invalid', file, `unknown key '${key}'; theme.json holds ${[...THEME_JSON_KEYS].join(', ')}`)
  }
  if (raw.extends !== undefined && typeof raw.extends !== 'string')
    throw new ThemeSourceError('theme-json-invalid', file, `'extends' must be the id of the parent theme`)
  if (raw.modes !== undefined && !isRecord(raw.modes))
    throw new ThemeSourceError('theme-json-invalid', file, `'modes' must be an object: mode -> { title?, colorScheme, extends?, fallbacks? }; key order is the order of modes`)
  for (const [mode, entry] of Object.entries(raw.modes ?? {})) {
    if (!isRecord(entry))
      throw new ThemeSourceError('theme-json-invalid', file, `'modes.${mode}' must be an object`)
    for (const key of Object.keys(entry)) {
      if (!key.startsWith('$') && !MODE_KEYS.has(key))
        throw new ThemeSourceError('theme-json-invalid', file, `unknown key 'modes.${mode}.${key}'; a mode declares title, colorScheme, extends, fallbacks — its tokens live in modes/${mode}.json`)
    }
  }
  return raw
}

/**
 * Исходник темы → данные темы (C-42). С `extends` данные — только отличия:
 * раскрывает их тот, кто тему собирает (сборка провайдера, резолвер приложения).
 * `sources` — прочитанные файлы: их правка в dev перезагружает конфиг (A-33).
 */
export function loadThemeSource(dir: string | URL, options: LoadThemeSourceOptions = {}): GranumAppTheme {
  const root = dir instanceof URL || dir.startsWith('file:') ? fileURLToPath(dir) : dir
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new ThemeSourceError('theme-json-missing', root, 'not a directory')
  const ignore = new Set((options.ignore ?? []).map(path => path.replace(/^\.\//, '').replace(/\/+$/, '')))
  const files: string[] = []
  const themeJson = join(root, 'theme.json')
  const meta = readThemeJson(themeJson)
  files.push(themeJson)

  const declared = new Set(Object.keys((meta.modes as Record<string, unknown> | undefined) ?? {}))
  const names = entries(root, root, ignore)
  const known = new Set(['theme.json', 'root.json', 'root.css', 'base.css', 'modes', 'components'])
  for (const name of names) {
    if (!known.has(name))
      throw unexpected(join(root, name), 'a theme source holds theme.json, root.{json,css}, base.css, modes/ and components/')
  }

  const rootFile = valueFile(root, names, 'root')
  if (rootFile !== undefined)
    files.push(rootFile)
  const modeTokens = names.includes('modes') ? readModesDir(join(root, 'modes'), root, ignore, declared, files) : {}
  const components = names.includes('components') ? readComponents(join(root, 'components'), root, ignore, declared, files) : {}
  let baseCss: string | undefined
  if (names.includes('base.css')) {
    if (!statSync(join(root, 'base.css')).isFile())
      throw unexpected(join(root, 'base.css'), 'base.css is a file')
    baseCss = readFileSync(join(root, 'base.css'), 'utf8')
    files.push(join(root, 'base.css'))
  }

  const modes: Record<string, GranumModeData> = {}
  for (const [mode, entry] of Object.entries((meta.modes as Record<string, Record<string, unknown>> | undefined) ?? {}))
    modes[mode] = { ...withoutNotes(entry), tokens: modeTokens[mode] ?? {} } as unknown as GranumModeData

  const { modes: _modes, ...rest } = withoutNotes(meta)
  const data = {
    ...rest,
    root: rootFile === undefined ? {} : readTokenFile(rootFile),
    modes,
    ...(baseCss !== undefined ? { baseCss: [baseCss] } : {}),
    ...(Object.keys(components).length > 0 ? { components } : {}),
  }
  const { extends: base, ...shape } = data as Record<string, unknown>
  const issue = checkThemeData(shape, { partial: base !== undefined })
  if (issue)
    throw new ThemeSourceError('theme-data-invalid', issue.path ? `${themeJson} (${issue.path})` : themeJson, issue.details, { dataReason: issue.reason })
  return { ...(data as unknown as GranumAppTheme), sources: files.sort() }
}
