/**
 * Точка входа `./contract`: типы контракта и `define*`-хелперы.
 * Единственное, что импортирует браузерный код провайдера. Без `node:`,
 * без внешних зависимостей, хелперы чисты.
 */
import type { GranumComponentDependency, GranumComponentDescriptor, GranumProvider } from './types'
import { assertComponentDescriptor, validateProvider } from './validate'

export type * from './manifest'
export { GRANUM_MANIFEST_VERSION, isLoadedManifest } from './manifest'
export type * from './types'
export { GRANUM_CONTRACT_VERSION } from './types'
export { COMPONENT_NAME_PATTERN, isValidComponentName, validateProvider } from './validate'

/**
 * Регистрирует провайдер: проверяет контракт сразу и
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
  readonly hookTokens?: readonly string[]
  /** Пути относительно `config.ts`: `'./styles.css'`, `'./css/extra.css'`. */
  readonly cssFiles?: readonly string[]
  /** Папка токенов компонента по темам относительно `config.ts`: `'./themes'`. */
  readonly themesDir?: string
  readonly group?: string
}

/**
 * Создаёт дескриптор компонента: `cssFiles` и `themesDir` нормализуются к путям
 * относительно корня раскладки (`components/<Name>/<file>`), исходное
 * расположение сохраняется в `sourceUrl`.
 *
 * Хелпер чистый, и бандлер вправе выбросить вызов, чей результат не нужен:
 * дескриптор, реэкспортированный из entry компонента, клиенту приложения обычно
 * ни к чему, и с ним из бандла уходит встроенная в провайдер копия контракта —
 * у каждого провайдера она своя. Проверку формы вызов уже прошёл на сборке
 * провайдера.
 */
/* @__NO_SIDE_EFFECTS__ */
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
    hookTokens: [...(options.hookTokens ?? [])],
    cssFiles: (options.cssFiles ?? []).map(file => componentRelativePath(options.name, file)),
    ...(options.themesDir !== undefined ? { themesDir: componentRelativePath(options.name, options.themesDir, 'themesDir') } : {}),
    ...(options.group ? { group: options.group } : {}),
    sourceUrl: importMetaUrl,
  }
  for (const key of ['tokenDefinitions', 'tokenDefinitionsRef']) {
    if ((options as unknown as Record<string, unknown>)[key] !== undefined)
      assertComponentDescriptor({ ...descriptor, [key]: (options as unknown as Record<string, unknown>)[key] } as GranumComponentDescriptor<Name>)
  }
  assertComponentDescriptor(descriptor)
  return descriptor
}

/**
 * `./styles.css` → `components/<Name>/styles.css`. Путь, выходящий за
 * директорию компонента, отклоняется: в раскладке ему негде лежать.
 */
function componentRelativePath(name: string, file: string, field: 'cssFiles' | 'themesDir' = 'cssFiles'): string {
  const segments: string[] = []
  for (const segment of file.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.')
      continue
    if (segment === '..') {
      if (segments.length === 0)
        throw new TypeError(`defineGranumComponent: ${field} entry '${file}' escapes 'components/${name}/'`)
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (segments.length === 0)
    throw new TypeError(`defineGranumComponent: ${field} entry '${file}' is not a path inside the component`)
  return `components/${name}/${segments.join('/')}`
}

/**
 * База раскладки для объектной формы провайдера: директория на
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
