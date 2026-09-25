/**
 * Раскладка `dist` провайдера (B-1, B-2, INV-LAY-1, INV-LAY-4): чанки SFC
 * компонента — в `components/<Name>/chunks/`, общие SFC группы — в
 * `groups/<g>/shared/`, всё прочее — в `chunks/`. Принадлежность модуля
 * определяется по директориям исходников из `descriptor.sourceUrl`, а не
 * по регулярному выражению: групповая раскладка `<group>/<Name>/` иначе
 * не распознаётся.
 */
import type { GranumComponentDescriptor } from '../contract'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface ComponentSource {
  readonly name: string
  /** Абсолютный путь директории компонента (без завершающего разделителя). */
  readonly dir: string
  readonly group: string | null
  /** Директория общих SFC группы: `<родитель компонента>/shared`. */
  readonly sharedDir: string | null
}

export function componentSourceDir(descriptor: GranumComponentDescriptor): string | undefined {
  if (!descriptor.sourceUrl)
    return undefined
  const path = descriptor.sourceUrl.startsWith('file:') ? fileURLToPath(descriptor.sourceUrl) : descriptor.sourceUrl
  const dir = path.replace(/[\\/][^\\/]*$/, '')
  // Бандлер отдаёт id модулей реальными путями (симлинки раскрыты); директория
  // из `sourceUrl` обязана быть в той же форме, иначе префикс не совпадёт.
  let real = dir
  try {
    real = realpathSync.native(dir)
  }
  catch {
    // Директории нет на диске (тесты на синтетических путях) — сравниваем как есть.
  }
  return normalizeSlashes(real)
}

export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

export function collectComponentSources(components: readonly GranumComponentDescriptor[]): ComponentSource[] {
  const out: ComponentSource[] = []
  for (const descriptor of components) {
    const dir = componentSourceDir(descriptor)
    if (!dir)
      continue
    const group = descriptor.group ?? null
    out.push({
      name: descriptor.name,
      dir,
      group,
      sharedDir: group ? `${dir.replace(/\/[^/]*$/, '')}/shared` : null,
    })
  }
  // Длинные пути раньше коротких: вложенная директория побеждает родительскую.
  return out.sort((a, b) => b.dir.length - a.dir.length)
}

export type ModuleOwner
  = | { readonly kind: 'component', readonly name: string }
    | { readonly kind: 'group', readonly group: string }
    | { readonly kind: 'shared' }

/** Кому принадлежит модуль по его id (абсолютный путь, возможно с `?query`). */
export function classifyModule(id: string, sources: readonly ComponentSource[]): ModuleOwner {
  const path = normalizeSlashes(id).replace(/[?#].*$/, '')
  // Общие SFC группы — раньше компонентов: `groupA/shared/X.vue` лежит внутри
  // родителя компонента, но не внутри самого компонента.
  for (const source of sources) {
    if (source.sharedDir && path.startsWith(`${source.sharedDir}/`))
      return { kind: 'group', group: source.group! }
  }
  for (const source of sources) {
    if (path.startsWith(`${source.dir}/`))
      return { kind: 'component', name: source.name }
  }
  return { kind: 'shared' }
}

export interface ChunkInfoLike {
  readonly moduleIds?: readonly string[]
  readonly name?: string
}

export interface AssetInfoLike {
  readonly name?: string | undefined
  readonly names?: readonly string[]
  readonly originalFileNames?: readonly string[]
}

/** `output.chunkFileNames` по раскладке контракта. */
export function granumChunkFileNames(sources: readonly ComponentSource[]): (chunk: ChunkInfoLike) => string {
  return (chunk) => {
    for (const id of chunk.moduleIds ?? []) {
      const owner = classifyModule(id, sources)
      if (owner.kind === 'group')
        return `groups/${owner.group}/shared/[name]-[hash].js`
    }
    for (const id of chunk.moduleIds ?? []) {
      const owner = classifyModule(id, sources)
      if (owner.kind === 'component')
        return `components/${owner.name}/chunks/[name]-[hash].js`
    }
    return 'chunks/[name]-[hash].js'
  }
}

/**
 * `output.assetFileNames`: CSS компонента — в `components/<Name>/styles.css`.
 * Компонент опознаётся по исходным файлам ассета (SFC внутри директории
 * компонента) либо по имени `<Name>.css`.
 */
export function granumAssetFileNames(sources: readonly ComponentSource[]): (asset: AssetInfoLike) => string {
  const known = new Set(sources.map(s => s.name))
  return (asset) => {
    const name = asset.names?.[0] ?? asset.name
    if (!name || !name.endsWith('.css'))
      return '[name]-[hash][extname]'
    for (const original of asset.originalFileNames ?? []) {
      const owner = classifyModule(original, sources)
      if (owner.kind === 'component')
        return `components/${owner.name}/styles.css`
    }
    const base = name.slice(0, -'.css'.length)
    if (known.has(base))
      return `components/${base}/styles.css`
    return '[name]-[hash][extname]'
  }
}

export function componentEntryFileName(name: string): string {
  return `components/${name}/index.js`
}

/** Владелец собранного файла по его пути в `dist`. */
export function classifyOutputFile(fileName: string): ModuleOwner {
  const component = /^components\/([^/]+)\//.exec(fileName)
  if (component)
    return { kind: 'component', name: component[1]! }
  const group = /^groups\/([^/]+)\/shared\//.exec(fileName)
  if (group)
    return { kind: 'group', group: group[1]! }
  return { kind: 'shared' }
}
