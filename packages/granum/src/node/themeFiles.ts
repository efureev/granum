/**
 * Файлы тем на диске: данные темы (JSON `GranumThemeData`), реестр токенов и
 * папка `themesDir` компонента. Читают их сборка провайдера —
 * чтобы материализовать в манифест — и медленный путь объектной формы.
 */
import type { GranumComponentDescriptor, GranumComponentThemeTokens, GranumManifestCatalogEntry, GranumProvider, GranumThemeData } from '../contract'
import type { ThemeDataIssue, TokenNature } from '../core/themeData'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InvalidProviderError, InvalidTokenKeyError, TokenParseError, TokenRefError } from '../core/errors'
import { checkThemeData, DEFAULT_MODE, isModeName, isThemeId, themeModeOrder } from '../core/themeData'
import { parseCssTokenBlocksFromText } from './cssTokens'

/** Нарушение формы данных темы → ошибка провайдера с путём до поля. */
export function themeDataError(providerId: string, themeId: string, issue: ThemeDataIssue): InvalidProviderError {
  const reason = issue.reason === 'token-key-prefix' ? 'invalid-theme-data' : issue.reason
  const at = issue.path ? ` at '${issue.path}'` : ''
  return new InvalidProviderError(providerId, reason, `theme '${themeId}'${at}: ${issue.details}.`)
}

export function readJsonFile(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Реестр токенов: `{ "<токен без -->": "root" | "mode" }`. */
export function readRegistry(providerId: string, file: string): Record<string, TokenNature> {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  }
  catch (cause) {
    throw new InvalidProviderError(providerId, 'invalid-theme-data', `cannot read the token registry ${file}: ${(cause as Error).message}.`)
  }
  return parseRegistry(providerId, file, text)
}

/** Реестр из уже прочитанного текста файла `file` — тем же правилом, что `readRegistry`. */
export function parseRegistry(providerId: string, file: string, text: string): Record<string, TokenNature> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  }
  catch (cause) {
    throw new InvalidProviderError(providerId, 'invalid-theme-data', `cannot read the token registry ${file}: ${(cause as Error).message}.`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new InvalidProviderError(providerId, 'invalid-theme-data', `the token registry ${file} must be an object of "<token>": "root" | "mode".`)
  for (const [token, nature] of Object.entries(raw)) {
    if (token.startsWith('--'))
      throw new InvalidTokenKeyError(providerId, token, 'registry')
    if (nature !== 'root' && nature !== 'mode')
      throw new InvalidProviderError(providerId, 'invalid-theme-data', `the token registry ${file}: '${token}' must be "root" or "mode", got ${JSON.stringify(nature)}.`)
  }
  return raw as Record<string, TokenNature>
}

/** Данные темы с диска; `partial` — исходник темы с `extends` в каталоге. */
export function readThemeDataFile(providerId: string, themeId: string, file: string, options: { readonly partial?: boolean, readonly flattened?: boolean } = {}): GranumThemeData {
  let raw: unknown
  try {
    raw = readJsonFile(file)
  }
  catch (cause) {
    throw new InvalidProviderError(providerId, 'invalid-theme-data', `cannot read the data of theme '${themeId}' (${file}): ${(cause as Error).message}.`)
  }
  const issue = checkThemeData(raw, options)
  if (issue)
    throw themeDataError(providerId, themeId, issue)
  return raw as GranumThemeData
}

/**
 * Файл значений токенов компонента: JSON `{ "<токен>": "<значение>" }` либо CSS
 * с одним плоским блоком — его селектор не важен, селекторы назначает
 * приложение.
 */
function readTokenFile(providerId: string, componentName: string, scope: string, file: string): Record<string, string> {
  try {
    if (file.endsWith('.json')) {
      const raw = readJsonFile(file)
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        throw new TypeError('expected an object of "<token>": "<value>" strings')
      // Ключ с `$` — пояснение автора (`"$comment"`), а не токен: в JSON комментариев нет.
      const tokens = Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith('$')))
      if (!Object.values(tokens).every(v => typeof v === 'string'))
        throw new TypeError('expected an object of "<token>": "<value>" strings')
      for (const token of Object.keys(tokens)) {
        if (token.startsWith('--'))
          throw new InvalidTokenKeyError(providerId, token, scope, componentName)
      }
      return tokens as Record<string, string>
    }
    const { blocks, skipped } = parseCssTokenBlocksFromText(readFileSync(file, 'utf8'))
    if (blocks.length !== 1 || skipped.length > 0) {
      throw new TokenParseError(
        `${file} must hold exactly one flat block of custom properties (found ${blocks.length} flat block(s)${skipped.length > 0 ? ` and ${skipped.length} nested or at-rule block(s)` : ''}).`,
        file,
        'unsupported-blocks',
      )
    }
    return blocks[0]!.tokens
  }
  catch (cause) {
    if (cause instanceof InvalidTokenKeyError)
      throw cause
    throw new TokenRefError(providerId, scope, componentName, file, { cause })
  }
}

/** Файлы папки без скрытых (`.DS_Store`) и без `README.md`. */
function entries(dir: string): string[] {
  return readdirSync(dir).filter(name => !name.startsWith('.') && name !== 'README.md').sort()
}

/** Файл значений по базовому имени: `.json` или `.css`, но не оба. */
function valueFile(providerId: string, componentName: string, dir: string, base: string): string | undefined {
  const found = ['.json', '.css'].map(ext => join(dir, `${base}${ext}`)).filter(existsSync)
  if (found.length > 1)
    throw new InvalidProviderError(providerId, 'invalid-theme-dir', `'${base}' is given twice in ${dir}: keep either the .json or the .css file.`, componentName)
  return found[0]
}

/**
 * Папка `themesDir`: `<тема>/root.{json,css}` и `<тема>/modes/<режим>.{json,css}`.
 * Имя подпапки — id темы, имя файла режима — имя режима.
 */
export function readComponentThemesDir(providerId: string, componentName: string, dir: string): Record<string, GranumComponentThemeTokens> {
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    throw new InvalidProviderError(providerId, 'invalid-theme-dir', `'themesDir' ${dir} is not a directory.`, componentName)
  const out: Record<string, GranumComponentThemeTokens> = {}
  for (const theme of entries(dir)) {
    const themeDir = join(dir, theme)
    if (!statSync(themeDir).isDirectory() || !isThemeId(theme))
      throw new InvalidProviderError(providerId, 'invalid-theme-dir', `'${theme}' in ${dir} must be a folder named by a theme id /^[a-z][a-z0-9-]*$/.`, componentName)
    for (const name of entries(themeDir)) {
      if (name !== 'modes' && name !== 'root.json' && name !== 'root.css')
        throw new InvalidProviderError(providerId, 'invalid-theme-dir', `unexpected '${name}' in ${themeDir}: a theme folder holds root.{json,css} and modes/.`, componentName)
    }
    const rootFile = valueFile(providerId, componentName, themeDir, 'root')
    const modes: Record<string, Record<string, string>> = {}
    const modesDir = join(themeDir, 'modes')
    if (existsSync(modesDir)) {
      for (const file of entries(modesDir)) {
        const match = /^(.+)\.(?:json|css)$/.exec(file)
        if (!match || !isModeName(match[1]))
          throw new InvalidProviderError(providerId, 'invalid-theme-dir', `'${file}' in ${modesDir} must be <mode>.json or <mode>.css with a mode name /^[a-z][a-z0-9]*$/.`, componentName)
        if (modes[match[1]!] !== undefined)
          continue
        modes[match[1]!] = readTokenFile(providerId, componentName, `${theme}/${match[1]}`, valueFile(providerId, componentName, modesDir, match[1]!)!)
      }
    }
    out[theme] = {
      ...(rootFile !== undefined ? { root: readTokenFile(providerId, componentName, `${theme}/root`, rootFile) } : {}),
      modes,
    }
  }
  return out
}

/** Все токены компонента по темам, без `--`. */
export function componentThemeTokenNames(themes: Readonly<Record<string, GranumComponentThemeTokens>>): string[] {
  const names = new Set<string>()
  for (const entry of Object.values(themes)) {
    for (const token of Object.keys(entry.root ?? {}))
      names.add(token)
    for (const tokens of Object.values(entry.modes)) {
      for (const token of Object.keys(tokens))
        names.add(token)
    }
  }
  return [...names].sort()
}

/**
 * Папка `themesDir` дескриптора на диске: от `config.ts` (`sourceUrl`), иначе
 * от раскладки (`baseDir`). `themesDir` после `define*` — путь от корня
 * раскладки, `components/<Name>/<dir>`.
 */
export function componentThemesDirPath(descriptor: Pick<GranumComponentDescriptor, 'name' | 'themesDir' | 'sourceUrl'>, baseDir?: string): string | undefined {
  if (descriptor.themesDir === undefined)
    return undefined
  const prefix = `components/${descriptor.name}/`
  if (descriptor.sourceUrl?.startsWith('file:') && descriptor.themesDir.startsWith(prefix))
    return fileURLToPath(new URL(descriptor.themesDir.slice(prefix.length), descriptor.sourceUrl))
  return baseDir === undefined ? undefined : join(baseDir, descriptor.themesDir)
}

/** Токены по темам компонентов объектного провайдера: компонент → тема → токены. */
export function readObjectComponentThemes(provider: GranumProvider, baseDir?: string): Record<string, Record<string, GranumComponentThemeTokens>> {
  const out: Record<string, Record<string, GranumComponentThemeTokens>> = {}
  for (const descriptor of provider.components) {
    const dir = componentThemesDirPath(descriptor, baseDir)
    if (dir !== undefined)
      out[descriptor.name] = readComponentThemesDir(provider.id, descriptor.name, dir)
  }
  return out
}

/**
 * Индекс каталога объектного провайдера по данным с диска. Данные
 * объектной формы обязаны быть полными: дополнять их из родителя умеет
 * только сборка провайдера. Запись `{ source }` в индекс не входит: раскрыть
 * исходник некому, а ошибку получает только сборка, которой эта тема нужна (C-43).
 * Данные могут быть записаны сборкой 3.10 — со значениями раздела, слитыми в
 * `root`/`modes` (C-44).
 */
export function readObjectCatalog(provider: GranumProvider, baseDir: string, onData?: (data: GranumThemeData) => void): Record<string, GranumManifestCatalogEntry> {
  const out: Record<string, GranumManifestCatalogEntry> = {}
  for (const [id, entry] of Object.entries(provider.theme?.catalog ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if ('source' in entry)
      continue
    const data = readThemeDataFile(provider.id, id, join(baseDir, entry.data), { flattened: true })
    onData?.(data)
    out[id] = {
      title: entry.title,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.docs !== undefined ? { docs: entry.docs } : {}),
      ...(entry.extends !== undefined ? { extends: entry.extends } : {}),
      data: entry.data,
      modes: themeModeOrder(data),
      defaultMode: data.defaultMode ?? DEFAULT_MODE,
      ...(data.version !== undefined ? { version: data.version } : {}),
      ...(data.targets !== undefined ? { targets: data.targets } : {}),
    }
  }
  return out
}

/** Исходник темы читает только сборка провайдера (C-43): у несобранного провайдера его нечем раскрыть. */
export function themeSourceUnbuilt(providerId: string, id: string, source: string): InvalidProviderError {
  return new InvalidProviderError(
    providerId,
    'theme-source-unbuilt',
    `catalog theme '${id}' is a theme source (${source}); sources are read by the provider build — build the provider, or pass the theme as { title, data }.`,
  )
}
