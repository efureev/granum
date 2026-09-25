/**
 * Чтение, проверка и запись `granum.manifest.json` (ТЗ §7, `docs/manifest.md`).
 * Node-only: `node:crypto` для хеша, `node:fs` для файлов, `node:module` для
 * поиска манифеста через `exports` пакета.
 */
import type { GranumLoadedManifest, GranumManifest, GranumTokenSet } from '../contract'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GRANUM_CONTRACT_VERSION, GRANUM_MANIFEST_VERSION } from '../contract'
import { InvalidManifestError, ManifestNotFoundError, UnsupportedContractVersionError, UnsupportedManifestVersionError } from '../core/errors'

export const MANIFEST_FILE_NAME = 'granum.manifest.json'

/** Порядок ключей корня — фиксированный, ради читаемых диффов (manifest.md §5). */
const ROOT_KEY_ORDER = [
  'granum',
  'contractVersion',
  'id',
  'version',
  'generatedBy',
  'hash',
  'dependencies',
  'theme',
  'engineModule',
  'components',
  'warnings',
] as const

/** Массивы, чей порядок семантичен и не сортируется. */
const ORDERED_ARRAYS = new Set(['css', 'defaultThemes', 'warnings'])

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

/** `sha256-<hex>` от канонической сериализации с пустым полем `hash` (INV-MAN-1). */
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
 * Разбор и проверка текста манифеста в порядке manifest.md §4; останавливается
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

  if (raw.granum !== GRANUM_MANIFEST_VERSION)
    throw new UnsupportedManifestVersionError(raw.granum, GRANUM_MANIFEST_VERSION, file)

  const manifest = validateSchema(raw, file)

  if (manifest.contractVersion !== GRANUM_CONTRACT_VERSION)
    throw new UnsupportedContractVersionError(manifest.id, manifest.contractVersion, GRANUM_CONTRACT_VERSION)

  validatePaths(manifest, file)

  const expected = computeManifestHash(manifest)
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

  validateTokenKeys(manifest.theme.tokenDefinitions, 'theme.tokenDefinitions', file)
  for (const [name, component] of Object.entries(manifest.components))
    validateTokenKeys(component.tokens.declares, `components.${name}.tokens.declares`, file)

  if (!baseUrl.endsWith('/'))
    throw new TypeError(`parseManifest: baseUrl must end with '/', got '${baseUrl}'`)

  return { manifest, baseUrl }
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
 * Находит манифест пакета через его `exports` (A-2): `require.resolve` от
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

/** `locateManifest` + `readManifestSync`. */
export function loadPackageManifest(packageName: string, fromDir: string): GranumLoadedManifest {
  return readManifestSync(locateManifest(packageName, fromDir))
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

function expectTokenSets(value: unknown, path: string, file?: string): Record<string, GranumTokenSet> {
  const record = expectRecord(value, path, file)
  for (const [theme, set] of Object.entries(record)) {
    const s = expectRecord(set, `${path}.${theme}`, file)
    if (s.selector !== undefined)
      expectString(s.selector, `${path}.${theme}.selector`, file)
    expectStringRecord(s.tokens, `${path}.${theme}.tokens`, file)
  }
  return record as unknown as Record<string, GranumTokenSet>
}

function describe(value: unknown): string {
  if (value === null)
    return 'null'
  if (Array.isArray(value))
    return 'an array'
  return typeof value
}

function validateSchema(raw: Record<string, unknown>, file?: string): GranumManifest {
  const id = expectString(raw.id, 'id', file)
  const theme = expectRecord(raw.theme, 'theme', file)
  const components = expectRecord(raw.components, 'components', file)
  if (raw.engineModule !== null)
    expectString(raw.engineModule, 'engineModule', file)
  if (!Array.isArray(raw.warnings))
    throw schema('warnings', `expected an array, got ${describe(raw.warnings)}`, file)
  for (const [i, warning] of raw.warnings.entries())
    expectString(expectRecord(warning, `warnings.${i}`, file).code, `warnings.${i}.code`, file)

  if (theme.tokensCss !== undefined)
    expectString(theme.tokensCss, 'theme.tokensCss', file)
  if (theme.baseCss !== undefined)
    expectString(theme.baseCss, 'theme.baseCss', file)
  expectStringRecord(theme.themes, 'theme.themes', file)
  expectStringArray(theme.defaultThemes, 'theme.defaultThemes', file)
  expectTokenSets(theme.tokenDefinitions, 'theme.tokenDefinitions', file)
  expectStringArray(theme.declares, 'theme.declares', file)

  for (const [name, value] of Object.entries(components)) {
    const p = `components.${name}`
    const c = expectRecord(value, p, file)
    expectString(c.entry, `${p}.entry`, file)
    expectStringArray(c.files, `${p}.files`, file)
    expectStringArray(c.css, `${p}.css`, file)
    if (c.group !== null)
      expectString(c.group, `${p}.group`, file)
    expectStringArray(c.dependencies, `${p}.dependencies`, file)
    expectStringArray(c.classes, `${p}.classes`, file)
    expectStringArray(c.safelist, `${p}.safelist`, file)
    const tokens = expectRecord(c.tokens, `${p}.tokens`, file)
    expectTokenSets(tokens.declares, `${p}.tokens.declares`, file)
    expectStringArray(tokens.consumes, `${p}.tokens.consumes`, file)
    expectStringArray(tokens.dynamic, `${p}.tokens.dynamic`, file)
    expectString(c.hash, `${p}.hash`, file)
  }

  return {
    granum: GRANUM_MANIFEST_VERSION,
    contractVersion: raw.contractVersion as 1,
    id,
    version: expectString(raw.version, 'version', file),
    generatedBy: expectString(raw.generatedBy, 'generatedBy', file),
    hash: expectString(raw.hash, 'hash', file),
    dependencies: expectStringArray(raw.dependencies, 'dependencies', file),
    theme: theme as unknown as GranumManifest['theme'],
    engineModule: raw.engineModule as string | null,
    components: components as unknown as GranumManifest['components'],
    warnings: raw.warnings as GranumManifest['warnings'],
  }
}

/** Путь относителен к манифесту, POSIX, без `..` и без выхода за пакет (INV-MAN-2). */
export function isPackageRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || /^[a-z]+:/i.test(path))
    return false
  return !path.split('/').some(segment => segment === '..' || segment === '.' || segment === '')
}

function validatePaths(manifest: GranumManifest, file?: string): void {
  const check = (path: string | undefined, at: string): void => {
    if (path !== undefined && !isPackageRelativePath(path))
      throw new InvalidManifestError('path-escapes-package', `'${path}' must be a relative POSIX path inside the package, without '..'`, at, file)
  }
  check(manifest.theme.tokensCss, 'theme.tokensCss')
  check(manifest.theme.baseCss, 'theme.baseCss')
  for (const [theme, path] of Object.entries(manifest.theme.themes))
    check(path, `theme.themes.${theme}`)
  if (manifest.engineModule !== null)
    check(manifest.engineModule, 'engineModule')
  for (const [name, component] of Object.entries(manifest.components)) {
    check(component.entry, `components.${name}.entry`)
    component.files.forEach((p, i) => check(p, `components.${name}.files.${i}`))
    component.css.forEach((p, i) => check(p, `components.${name}.css.${i}`))
  }
}

function validateTokenKeys(sets: Readonly<Record<string, GranumTokenSet>>, at: string, file?: string): void {
  for (const [theme, set] of Object.entries(sets)) {
    for (const token of Object.keys(set.tokens)) {
      if (token.startsWith('--'))
        throw new InvalidManifestError('token-key-prefix', `token key '${token}' must not start with '--'`, `${at}.${theme}.tokens`, file)
    }
  }
}
