/**
 * Чтение, проверка и запись `granum.manifest.json` (`docs/manifest.md`).
 * Node-only: `node:crypto` для хеша, `node:fs` для файлов, `node:module` для
 * поиска манифеста через `exports` пакета.
 */
import type { GranumComponentThemeTokens, GranumLoadedManifest, GranumManifest, GranumManifestEngine } from '../contract'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GRANUM_CONTRACT_VERSION, GRANUM_MANIFEST_VERSION, isValidComponentName } from '../contract'
import { InvalidManifestError, ManifestNotFoundError, UnsupportedContractVersionError, UnsupportedManifestVersionError } from '../core/errors'
import { isModeName, isThemeId } from '../core/themeData'
import { isDialect } from '../engine/dialect'

export const MANIFEST_FILE_NAME = 'granum.manifest.json'

/** Порядок ключей корня — фиксированный, ради читаемых диффов. */
const ROOT_KEY_ORDER = [
  'granum',
  'contractVersion',
  'id',
  'version',
  'generatedBy',
  'hash',
  'dependencies',
  'theme',
  'engine',
  'components',
  'warnings',
] as const

/**
 * Массивы, чей порядок семантичен и не сортируется. `defaultThemes` — поле
 * формата 2: хеш манифеста спутника сверяется в его собственной канонизации.
 */
const ORDERED_ARRAYS = new Set(['css', 'defaultThemes', 'modes', 'warnings'])

const collator = new Intl.Collator('en')

/** Канонический JSON: корень в фиксированном порядке, остальные ключи и массивы строк отсортированы. */
export function canonicalizeManifest(manifest: GranumManifest): string {
  const root: Record<string, unknown> = {}
  for (const key of ROOT_KEY_ORDER)
    root[key] = canonicalize((manifest as unknown as Record<string, unknown>)[key], key)
  return `${JSON.stringify(root, null, 2)}\n`
}

function canonicalize(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map(item => canonicalize(item, key))
    if (!ORDERED_ARRAYS.has(key) && items.every(item => typeof item === 'string'))
      return [...(items as string[])].sort(collator.compare)
    return items
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as object).sort(collator.compare))
      out[k] = canonicalize((value as Record<string, unknown>)[k], k)
    return out
  }
  return value
}

/** `sha256-<hex>` от канонической сериализации с пустым полем `hash`. */
export function computeManifestHash(manifest: GranumManifest): string {
  const text = canonicalizeManifest({ ...manifest, hash: '' })
  return `sha256-${createHash('sha256').update(text).digest('hex')}`
}

/** Проставляет `hash` и возвращает канонический текст файла. */
export function serializeManifest(manifest: Omit<GranumManifest, 'hash'> & { hash?: string }): string {
  const withHash: GranumManifest = { ...manifest, hash: '' }
  return canonicalizeManifest({ ...withHash, hash: computeManifestHash(withHash) })
}

export function writeManifestSync(file: string, manifest: Omit<GranumManifest, 'hash'> & { hash?: string }): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, serializeManifest(manifest))
}

/**
 * Разбор и проверка текста манифеста в порядке `docs/manifest.md`; останавливается
 * на первой ошибке. Существование файлов, на которые ссылается манифест, не
 * проверяется (это делает `doctor` и чтение CSS при эмиссии).
 */
export function parseManifest(text: string, baseUrl: string, file?: string): GranumLoadedManifest {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  }
  catch (cause) {
    throw new InvalidManifestError('json', `not valid JSON (${(cause as Error).message})`, undefined, file)
  }
  if (!isRecord(raw))
    throw new InvalidManifestError('schema', 'root must be an object', undefined, file)

  const legacy = raw.granum === 2
  if (legacy) {
    const themed = legacyThemes(raw)
    if (themed !== undefined) {
      throw new UnsupportedManifestVersionError(
        raw.granum,
        GRANUM_MANIFEST_VERSION,
        file,
        `It ships themes (${themed}), and format 2 themes are CSS files that granum 3 no longer reads — rebuild the provider with @feugene/granum 3.`,
      )
    }
  }
  else if (raw.granum !== GRANUM_MANIFEST_VERSION) {
    throw new UnsupportedManifestVersionError(raw.granum, GRANUM_MANIFEST_VERSION, file)
  }

  const manifest = legacy ? validateLegacySchema(raw, file) : validateSchema(raw, file)

  const contractVersion = legacy ? 1 : GRANUM_CONTRACT_VERSION
  if (manifest.contractVersion !== contractVersion)
    throw new UnsupportedContractVersionError(manifest.id, manifest.contractVersion, contractVersion)

  validatePaths(manifest, file)
  validateDialectScope(manifest, file)

  // Хеш — от файла как он есть: у формата 2 своя форма, приведение к форме 3 идёт после.
  const expected = computeManifestHash(raw as unknown as GranumManifest)
  if (manifest.hash !== expected) {
    throw new InvalidManifestError(
      'hash-mismatch',
      `hash '${manifest.hash}' does not match the content (${expected}). The manifest was edited by hand or corrupted — rebuild the provider.`,
      'hash',
      file,
    )
  }

  for (const [name, component] of Object.entries(manifest.components)) {
    const entry = `components/${name}/index.js`
    if (component.entry !== entry)
      throw new InvalidManifestError('entry-layout', `expected '${entry}', got '${component.entry}'`, `components.${name}.entry`, file)
  }

  // После хеша, как раскладка entry: такое мог записать только писатель с ошибкой.
  validateSubcomponents(manifest, file)

  for (const [name, component] of Object.entries(manifest.components))
    validateComponentThemeKeys(component.tokens.themes ?? {}, `components.${name}.tokens.themes`, file)

  if (!baseUrl.endsWith('/'))
    throw new TypeError(`parseManifest: baseUrl must end with '/', got '${baseUrl}'`)

  return { manifest, baseUrl }
}

/**
 * Темы манифеста формата 2: CSS-файлы, структурные блоки, токены компонентов по
 * темам. Без них манифест спутника читается (M-11); с ними — нет.
 */
function legacyThemes(raw: Record<string, unknown>): string | undefined {
  const theme = isRecord(raw.theme) ? raw.theme : {}
  const found: string[] = []
  if (isRecord(theme.themes) && Object.keys(theme.themes).length > 0)
    found.push(`theme.themes: ${Object.keys(theme.themes).join(', ')}`)
  if (isRecord(theme.tokenDefinitions) && Object.keys(theme.tokenDefinitions).length > 0)
    found.push(`theme.tokenDefinitions: ${Object.keys(theme.tokenDefinitions).join(', ')}`)
  for (const [name, component] of Object.entries(isRecord(raw.components) ? raw.components : {})) {
    const declares = isRecord(component) && isRecord(component.tokens) && isRecord(component.tokens.declares) ? component.tokens.declares : {}
    if (Object.keys(declares).length > 0)
      found.push(`components.${name}.tokens.declares`)
  }
  return found.length > 0 ? found.join('; ') : undefined
}

export function readManifestSync(file: string): GranumLoadedManifest {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  }
  catch (cause) {
    throw new InvalidManifestError('json', `cannot read file (${(cause as Error).message})`, undefined, file)
  }
  return parseManifest(text, `${pathToFileURL(dirname(file)).href}/`, file)
}

/**
 * Находит манифест пакета через его `exports`: `require.resolve` от
 * каталога приложения, без исполнения кода пакета.
 */
export function locateManifest(packageName: string, fromDir: string): string {
  const require = createRequire(join(fromDir, 'package.json'))
  try {
    return require.resolve(`${packageName}/${MANIFEST_FILE_NAME}`)
  }
  catch (cause) {
    throw new ManifestNotFoundError(packageName, fromDir, { cause })
  }
}

/**
 * Кэш прочитанных манифестов на процесс: ключ — путь, версия —
 * размер и mtime файла. Повторная подготовка приложения в dev (правка
 * исходников, HMR) не перечитывает и не перехеширует манифесты; изменённый
 * манифест (`vite build --watch` у провайдера) читается заново.
 */
const manifestCache = new Map<string, { readonly stamp: string, readonly loaded: GranumLoadedManifest }>()

function fileStamp(file: string): string | undefined {
  try {
    const stat = statSync(file)
    return `${stat.size}:${stat.mtimeMs}`
  }
  catch {
    return undefined
  }
}

/** `readManifestSync` с кэшем по пути и stat файла. */
export function readManifestCached(file: string): GranumLoadedManifest {
  const stamp = fileStamp(file)
  const hit = manifestCache.get(file)
  if (hit && stamp !== undefined && hit.stamp === stamp)
    return hit.loaded
  const loaded = readManifestSync(file)
  if (stamp !== undefined)
    manifestCache.set(file, { stamp, loaded })
  return loaded
}

export function clearManifestCache(): void {
  manifestCache.clear()
}

/** `locateManifest` + `readManifestCached`. */
export function loadPackageManifest(packageName: string, fromDir: string): GranumLoadedManifest {
  return readManifestCached(locateManifest(packageName, fromDir))
}

// ---------------------------------------------------------------------------
// Схема
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function schema(path: string, details: string, file?: string): InvalidManifestError {
  return new InvalidManifestError('schema', details, path, file)
}

function expectString(value: unknown, path: string, file?: string): string {
  if (typeof value !== 'string')
    throw schema(path, `expected a string, got ${describe(value)}`, file)
  return value
}

function expectStringArray(value: unknown, path: string, file?: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string'))
    throw schema(path, `expected an array of strings, got ${describe(value)}`, file)
  return value as string[]
}

function expectRecord(value: unknown, path: string, file?: string): Record<string, unknown> {
  if (!isRecord(value))
    throw schema(path, `expected an object, got ${describe(value)}`, file)
  return value
}

function expectStringRecord(value: unknown, path: string, file?: string): Record<string, string> {
  const record = expectRecord(value, path, file)
  for (const [k, v] of Object.entries(record))
    expectString(v, `${path}.${k}`, file)
  return record as Record<string, string>
}

function expectOptionalString(value: unknown, path: string, file?: string): void {
  if (value !== undefined)
    expectString(value, path, file)
}

function expectComponentThemes(value: unknown, path: string, file?: string): Record<string, GranumComponentThemeTokens> {
  const record = expectRecord(value, path, file)
  for (const [theme, entry] of Object.entries(record)) {
    const at = `${path}.${theme}`
    if (!isThemeId(theme))
      throw schema(at, `theme id '${theme}' must be a slug /^[a-z][a-z0-9-]*$/`, file)
    const tokens = expectRecord(entry, at, file)
    if (tokens.root !== undefined)
      expectStringRecord(tokens.root, `${at}.root`, file)
    for (const [mode, values] of Object.entries(expectRecord(tokens.modes, `${at}.modes`, file))) {
      if (!isModeName(mode))
        throw schema(`${at}.modes.${mode}`, `mode name '${mode}' must match /^[a-z][a-z0-9]*$/ and not be 'root'`, file)
      expectStringRecord(values, `${at}.modes.${mode}`, file)
    }
  }
  return record as unknown as Record<string, GranumComponentThemeTokens>
}

function describe(value: unknown): string {
  if (value === null)
    return 'null'
  if (Array.isArray(value))
    return 'an array'
  return typeof value
}

function validateCommon(raw: Record<string, unknown>, file?: string): { id: string, theme: Record<string, unknown>, components: Record<string, unknown>, engine: GranumManifestEngine } {
  const id = expectString(raw.id, 'id', file)
  const theme = expectRecord(raw.theme, 'theme', file)
  const components = expectRecord(raw.components, 'components', file)
  const engine = validateEngineBlock(raw.engine, file)
  if (!Array.isArray(raw.warnings))
    throw schema('warnings', `expected an array, got ${describe(raw.warnings)}`, file)
  for (const [i, warning] of raw.warnings.entries())
    expectString(expectRecord(warning, `warnings.${i}`, file).code, `warnings.${i}.code`, file)
  expectOptionalString(theme.tokensCss, 'theme.tokensCss', file)
  expectOptionalString(theme.baseCss, 'theme.baseCss', file)
  return { id, theme, components, engine }
}

function validateComponentCommon(c: Record<string, unknown>, p: string, file?: string): Record<string, unknown> {
  expectString(c.entry, `${p}.entry`, file)
  expectStringArray(c.files, `${p}.files`, file)
  expectStringArray(c.css, `${p}.css`, file)
  if (c.group !== null)
    expectString(c.group, `${p}.group`, file)
  expectStringArray(c.dependencies, `${p}.dependencies`, file)
  expectStringArray(c.classes, `${p}.classes`, file)
  expectStringArray(c.safelist, `${p}.safelist`, file)
  const tokens = expectRecord(c.tokens, `${p}.tokens`, file)
  expectStringArray(tokens.consumes, `${p}.tokens.consumes`, file)
  if (tokens.requires !== undefined)
    expectStringArray(tokens.requires, `${p}.tokens.requires`, file)
  expectStringArray(tokens.dynamic, `${p}.tokens.dynamic`, file)
  expectString(c.hash, `${p}.hash`, file)
  if (c.subcomponents !== undefined) {
    for (const [i, part] of expectStringArray(c.subcomponents, `${p}.subcomponents`, file).entries()) {
      if (!isValidComponentName(part))
        throw schema(`${p}.subcomponents.${i}`, `'${part}' is not a valid component name`, file)
    }
  }
  return tokens
}

function manifestRoot(raw: Record<string, unknown>, file: string | undefined, rest: Pick<GranumManifest, 'granum' | 'theme' | 'engine' | 'components'>): GranumManifest {
  return {
    granum: rest.granum,
    contractVersion: raw.contractVersion as GranumManifest['contractVersion'],
    id: expectString(raw.id, 'id', file),
    version: expectString(raw.version, 'version', file),
    generatedBy: expectString(raw.generatedBy, 'generatedBy', file),
    hash: expectString(raw.hash, 'hash', file),
    dependencies: expectStringArray(raw.dependencies, 'dependencies', file),
    theme: rest.theme,
    engine: rest.engine,
    components: rest.components,
    warnings: raw.warnings as GranumManifest['warnings'],
  }
}

function validateSchema(raw: Record<string, unknown>, file?: string): GranumManifest {
  const { theme, components, engine } = validateCommon(raw, file)
  expectOptionalString(theme.registry, 'theme.registry', file)
  expectOptionalString(theme.defaultTheme, 'theme.defaultTheme', file)
  if (theme.declares !== undefined)
    expectStringArray(theme.declares, 'theme.declares', file)
  if (theme.catalog !== undefined) {
    for (const [id, value] of Object.entries(expectRecord(theme.catalog, 'theme.catalog', file))) {
      const at = `theme.catalog.${id}`
      if (!isThemeId(id))
        throw schema(at, `theme id '${id}' must be a slug /^[a-z][a-z0-9-]*$/`, file)
      const entry = expectRecord(value, at, file)
      expectString(entry.title, `${at}.title`, file)
      expectOptionalString(entry.description, `${at}.description`, file)
      expectOptionalString(entry.docs, `${at}.docs`, file)
      expectOptionalString(entry.extends, `${at}.extends`, file)
      expectString(entry.data, `${at}.data`, file)
      const modes = expectStringArray(entry.modes, `${at}.modes`, file)
      for (const mode of modes) {
        if (!isModeName(mode))
          throw schema(`${at}.modes`, `mode name '${mode}' must match /^[a-z][a-z0-9]*$/ and not be 'root'`, file)
      }
      const defaultMode = expectString(entry.defaultMode, `${at}.defaultMode`, file)
      if (modes[0] !== defaultMode)
        throw schema(`${at}.modes`, `the default mode '${defaultMode}' must come first`, file)
    }
  }
  for (const [name, value] of Object.entries(components)) {
    const p = `components.${name}`
    const tokens = validateComponentCommon(expectRecord(value, p, file), p, file)
    if (tokens.themes !== undefined)
      expectComponentThemes(tokens.themes, `${p}.tokens.themes`, file)
  }
  return manifestRoot(raw, file, {
    granum: GRANUM_MANIFEST_VERSION,
    theme: theme as unknown as GranumManifest['theme'],
    engine,
    components: components as unknown as GranumManifest['components'],
  })
}

/**
 * Манифест формата 2 без тем (M-11), приведённый к форме 3: остаются
 * тема-независимые файлы и объявленные токены, поля тем уходят. Хеш сверяется
 * по исходному файлу.
 */
function validateLegacySchema(raw: Record<string, unknown>, file?: string): GranumManifest {
  const { theme, components, engine } = validateCommon(raw, file)
  const declares = theme.declares === undefined ? [] : expectStringArray(theme.declares, 'theme.declares', file)
  const normalized: Record<string, GranumManifest['components'][string]> = {}
  for (const [name, value] of Object.entries(components)) {
    const p = `components.${name}`
    const component = expectRecord(value, p, file)
    const tokens = validateComponentCommon(component, p, file)
    const { declares: _declares, ...rest } = tokens
    normalized[name] = { ...component, tokens: rest } as unknown as GranumManifest['components'][string]
  }
  return manifestRoot(raw, file, {
    granum: 2,
    theme: {
      ...(theme.tokensCss !== undefined ? { tokensCss: theme.tokensCss as string } : {}),
      ...(theme.baseCss !== undefined ? { baseCss: theme.baseCss as string } : {}),
      declares,
    },
    engine,
    components: normalized,
  })
}

/**
 * Блок `engine`. Диалект и отпечаток обязаны быть `null`
 * одновременно: отпечаток без словаря нечему ключевать, а словарь без отпечатка
 * не даёт решить, верить ли списку классов.
 */
function validateEngineBlock(value: unknown, file?: string): GranumManifestEngine {
  const engine = expectRecord(value, 'engine', file)
  if (engine.dialect !== null) {
    const dialect = expectString(engine.dialect, 'engine.dialect', file)
    if (!isDialect(dialect))
      throw schema('engine.dialect', `expected '<vendor>/<vocabulary>@<major>', got ${JSON.stringify(dialect)}`, file)
  }
  if (engine.vocabulary !== null && expectString(engine.vocabulary, 'engine.vocabulary', file).length === 0)
    throw schema('engine.vocabulary', 'expected a non-empty string', file)
  if ((engine.dialect === null) !== (engine.vocabulary === null)) {
    throw new InvalidManifestError(
      'dialect-vocabulary-mismatch',
      `'engine.dialect' and 'engine.vocabulary' must both be null or both be set (dialect ${JSON.stringify(engine.dialect)}, vocabulary ${JSON.stringify(engine.vocabulary)})`,
      'engine',
      file,
    )
  }
  if (expectString(engine.name, 'engine.name', file).length === 0)
    throw schema('engine.name', 'expected a non-empty string', file)
  if (engine.version !== undefined)
    expectString(engine.version, 'engine.version', file)
  if (engine.module !== null)
    expectString(engine.module, 'engine.module', file)
  return engine as unknown as GranumManifestEngine
}

/**
 * Диалект `null` означает «артефакт ни от какого словаря не зависит и ни
 * одного не расширяет». Классы, safelist или модуль правил это опровергают, и
 * тогда `null` — не факт, а потерянная запись о движке.
 */
function validateDialectScope(manifest: GranumManifest, file?: string): void {
  if (manifest.engine.dialect !== null)
    return
  if (manifest.engine.module !== null) {
    throw new InvalidManifestError(
      'dialect-without-classes',
      `'engine.dialect' is null, but 'engine.module' ships rules — rules belong to a vocabulary, so name it`,
      'engine.module',
      file,
    )
  }
  for (const [name, component] of Object.entries(manifest.components)) {
    if (component.classes.length === 0 && component.safelist.length === 0)
      continue
    throw new InvalidManifestError(
      'dialect-without-classes',
      `'engine.dialect' is null, but component '${name}' has ${component.classes.length} classes and ${component.safelist.length} safelist entries — a class list was filtered by some engine, and the manifest must say which`,
      `components.${name}`,
      file,
    )
  }
}

/**
 * Сегмент `.` или `..` так, как его видит парсер URL: `%2e` в любом регистре —
 * тоже точка (WHATWG URL, «single-dot / double-dot path segment»). Пути
 * манифеста разрешаются через `new URL(path, baseUrl)`, поэтому `%2e%2e/x.css`
 * уходит на уровень выше ровно как `../x.css`.
 */
function dotSegment(segment: string): '.' | '..' | undefined {
  const decoded = segment.replace(/%2e/gi, '.')
  return decoded === '.' || decoded === '..' ? decoded : undefined
}

/**
 * Путь внутри пакета в форме, которую принимает `isPackageRelativePath`: без
 * `./`, пустых сегментов и `..`. Писатель манифеста нормализует им пути автора
 * (`./theme/tokens.css` → `theme/tokens.css`). `undefined` — путь абсолютный,
 * URL, с `\` или выходит за корень пакета.
 */
export function normalizePackagePath(path: string): string | undefined {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || /^[a-z]+:/i.test(path))
    return undefined
  const segments: string[] = []
  for (const segment of path.split('/')) {
    const dot = dotSegment(segment)
    if (segment === '' || dot === '.')
      continue
    if (dot === '..') {
      if (segments.length === 0)
        return undefined
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.length > 0 ? segments.join('/') : undefined
}

/** Путь относителен к манифесту, POSIX, без `..` и без выхода за пакет. */
export function isPackageRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || /^[a-z]+:/i.test(path))
    return false
  return !path.split('/').some(segment => segment === '' || dotSegment(segment) !== undefined)
}

function validatePaths(manifest: GranumManifest, file?: string): void {
  const check = (path: string | undefined, at: string): void => {
    if (path !== undefined && !isPackageRelativePath(path))
      throw new InvalidManifestError('path-escapes-package', `'${path}' must be a relative POSIX path inside the package, without '..'`, at, file)
  }
  check(manifest.theme.tokensCss, 'theme.tokensCss')
  check(manifest.theme.baseCss, 'theme.baseCss')
  check(manifest.theme.registry, 'theme.registry')
  for (const [id, entry] of Object.entries(manifest.theme.catalog ?? {}))
    check(entry.data, `theme.catalog.${id}.data`)
  if (manifest.engine.module !== null)
    check(manifest.engine.module, 'engine.module')
  for (const [name, component] of Object.entries(manifest.components)) {
    check(component.entry, `components.${name}.entry`)
    component.files.forEach((p, i) => check(p, `components.${name}.files.${i}`))
    component.css.forEach((p, i) => check(p, `components.${name}.css.${i}`))
  }
}

/** Часть — подпуть без собственного компонента, и владелец у неё один. */
function validateSubcomponents(manifest: GranumManifest, file?: string): void {
  const owners = new Map<string, string>()
  for (const [name, component] of Object.entries(manifest.components)) {
    for (const part of component.subcomponents ?? []) {
      if (Object.hasOwn(manifest.components, part))
        throw schema(`components.${name}.subcomponents`, `'${part}' is a component of its own, not a part of '${name}'`, file)
      const other = owners.get(part)
      if (other === name)
        throw schema(`components.${name}.subcomponents`, `'${part}' is listed twice`, file)
      if (other !== undefined)
        throw schema(`components.${name}.subcomponents`, `'${part}' is listed as a part of both '${other}' and '${name}'`, file)
      owners.set(part, name)
    }
  }
}

function validateComponentThemeKeys(themes: Readonly<Record<string, GranumComponentThemeTokens>>, at: string, file?: string): void {
  const check = (tokens: Readonly<Record<string, string>> | undefined, path: string): void => {
    for (const token of Object.keys(tokens ?? {})) {
      if (token.startsWith('--'))
        throw new InvalidManifestError('token-key-prefix', `token key '${token}' must not start with '--'`, path, file)
    }
  }
  for (const [theme, entry] of Object.entries(themes)) {
    check(entry.root, `${at}.${theme}.root`)
    for (const [mode, tokens] of Object.entries(entry.modes))
      check(tokens, `${at}.${theme}.modes.${mode}`)
  }
}
