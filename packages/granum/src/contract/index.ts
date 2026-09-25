/**
 * Точка входа `./contract` (ТЗ §5): типы контракта и `define*`-хелперы.
 * Единственное, что импортирует браузерный код провайдера. Без `node:`
 * (INV-BND-1), без внешних зависимостей (INV-DEP-1), хелперы чисты (C-20).
 */
import type { GranumComponentDependency, GranumComponentDescriptor, GranumProvider, GranumTokenRef, GranumTokenSet } from './types'
import { assertComponentDescriptor, validateProvider } from './validate'

export type * from './manifest'
export { GRANUM_MANIFEST_VERSION, isLoadedManifest } from './manifest'
export type * from './types'
export { GRANUM_CONTRACT_VERSION } from './types'
export { COMPONENT_NAME_PATTERN, isValidComponentName, validateProvider } from './validate'

/**
 * Регистрирует провайдер: проверяет контракт сразу (C-19, INV-ERR-1) и
 * возвращает тот же объект — identity сохраняется, на ней держится
 * дедупликация инстансов в графе.
 */
export function defineGranumProvider<P extends GranumProvider>(provider: P): P {
  validateProvider(provider)
  return provider
}

export interface DefineGranumComponentOptions<Name extends string = string> {
  readonly name: Name
  readonly dependencies?: readonly GranumComponentDependency[]
  readonly safelist?: readonly string[]
  readonly dynamicTokens?: readonly string[]
  /** Пути относительно `config.ts`: `'./styles.css'`, `'./css/extra.css'`. */
  readonly cssFiles?: readonly string[]
  readonly tokenDefinitions?: Readonly<Record<string, GranumTokenSet>>
  /** Ссылки на CSS с токенами; строка — сокращение для `{ url }`. */
  readonly tokenDefinitionsRef?: Readonly<Record<string, GranumTokenRef | string>>
  readonly group?: string
}

/**
 * Создаёт дескриптор компонента (C-18): `cssFiles` нормализуются к путям
 * относительно корня раскладки (`components/<Name>/<file>`), ссылки на токены
 * получают абсолютный `url`, исходное расположение сохраняется в `sourceUrl`.
 */
export function defineGranumComponent<Name extends string>(
  importMetaUrl: string,
  options: DefineGranumComponentOptions<Name>,
): GranumComponentDescriptor<Name> {
  if (typeof importMetaUrl !== 'string' || importMetaUrl.length === 0)
    throw new TypeError('defineGranumComponent: importMetaUrl must be a non-empty string')

  const descriptor: GranumComponentDescriptor<Name> = {
    name: options.name,
    dependencies: [...(options.dependencies ?? [])],
    safelist: [...(options.safelist ?? [])],
    dynamicTokens: [...(options.dynamicTokens ?? [])],
    cssFiles: (options.cssFiles ?? []).map(file => componentRelativePath(options.name, file)),
    ...(options.tokenDefinitions ? { tokenDefinitions: options.tokenDefinitions } : {}),
    ...(options.tokenDefinitionsRef
      ? { tokenDefinitionsRef: resolveTokenRefs(options.tokenDefinitionsRef, importMetaUrl) }
      : {}),
    ...(options.group ? { group: options.group } : {}),
    sourceUrl: importMetaUrl,
  }
  assertComponentDescriptor(descriptor)
  return descriptor
}

/**
 * `./styles.css` → `components/<Name>/styles.css`. Путь, выходящий за
 * директорию компонента, отклоняется: в раскладке ему негде лежать.
 */
function componentRelativePath(name: string, file: string): string {
  const segments: string[] = []
  for (const segment of file.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.')
      continue
    if (segment === '..') {
      if (segments.length === 0)
        throw new TypeError(`defineGranumComponent: cssFiles entry '${file}' escapes 'components/${name}/'`)
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (segments.length === 0)
    throw new TypeError(`defineGranumComponent: cssFiles entry '${file}' is not a file path`)
  return `components/${name}/${segments.join('/')}`
}

/** Приводит ссылки к объектной форме с абсолютным `url`. */
export function resolveTokenRefs(
  refs: Readonly<Record<string, GranumTokenRef | string>>,
  importMetaUrl: string,
): Record<string, GranumTokenRef> {
  return Object.fromEntries(
    Object.entries(refs).map(([theme, ref]) => {
      const normalized: GranumTokenRef = typeof ref === 'string' ? { url: ref } : ref
      return [theme, { ...normalized, url: new URL(normalized.url, importMetaUrl).href }]
    }),
  )
}

/**
 * База раскладки для объектной формы провайдера (C-6): директория на
 * `levelsUp` уровней выше модуля. Литерал `new URL('..', import.meta.url)`
 * в коде провайдера бандлер заменяет на `data:`-URL; здесь база приходит
 * аргументом, подставлять нечего.
 */
export function resolvePackageBaseUrl(importMetaUrl: string, levelsUp = 1): string {
  if (typeof importMetaUrl !== 'string' || importMetaUrl.length === 0)
    throw new TypeError('resolvePackageBaseUrl: importMetaUrl must be a non-empty string')
  if (!Number.isInteger(levelsUp) || levelsUp < 0)
    throw new TypeError(`resolvePackageBaseUrl: levelsUp must be a non-negative integer, got ${levelsUp}`)

  let end = importMetaUrl.lastIndexOf('/')
  if (end < 0)
    throw new TypeError(`resolvePackageBaseUrl: '${importMetaUrl}' has no path separator`)

  for (let i = 0; i < levelsUp; i++) {
    const next = importMetaUrl.lastIndexOf('/', end - 1)
    if (next < 0)
      throw new RangeError(`resolvePackageBaseUrl: cannot go ${levelsUp} level(s) up from '${importMetaUrl}'`)
    end = next
  }

  return importMetaUrl.slice(0, end + 1)
}
