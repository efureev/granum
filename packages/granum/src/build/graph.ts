/**
 * Анализ собранного бандла (B-6…B-9, B-16): какие файлы принадлежат
 * компоненту, какие рёбра между компонентами реально отгружены, что
 * извлекается из кода. Типы бандла структурные, чтобы модуль тестировался
 * на синтетических данных без Vite.
 */
import type { GranumComponentDescriptor } from '../contract'
import type { GranumEngine, GranumRule, GranumVariant } from '../engine/types'
import { builtinModules } from 'node:module'
import { sortedUnique } from '../core/dedupe'
import { normalizeDependency } from '../core/resolveSelection'
import { scanTokenConsumption } from '../node/tokenScan'
import { classifyOutputFile, componentEntryFileName } from './layout'

export interface BundleChunkLike {
  readonly type: 'chunk'
  readonly fileName: string
  readonly code: string
  readonly isEntry: boolean
  readonly name: string
  readonly imports: readonly string[]
  readonly dynamicImports: readonly string[]
  readonly viteMetadata?: { readonly importedCss?: ReadonlySet<string> } | undefined
}

export interface BundleAssetLike {
  readonly type: 'asset'
  readonly fileName: string
  readonly source: string | Uint8Array
}

export type BundleLike = Readonly<Record<string, BundleChunkLike | BundleAssetLike>>

export interface ComponentBundleInfo {
  readonly name: string
  /** Файлы компонента в `dist`: собственные чанки, общие чанки группы и `chunks/*`, до которых он дотягивается. */
  readonly files: string[]
  /** CSS-ассеты, эмитированные бандлером для файлов компонента. */
  readonly cssAssets: string[]
  /** Извлечённые статические классы. */
  readonly classes: string[]
  /** Потребляемые токены (с `--`). */
  readonly consumes: string[]
  /** Компоненты, чьи entry достигаются из entry этого: `Name` того же провайдера или `pkg:Name` чужого. */
  readonly edges: string[]
  /** Чанки, импортирующие CSS-ассет из списка (двойная доставка, INV-CSS-5). */
  readonly cssImportedByChunk: string[]
}

export interface BoundaryViolation {
  readonly file: string
  readonly specifier: string
  readonly kind: 'node-import' | 'granum-node-entry' | 'data-url'
}

export interface BundleAnalysis {
  readonly components: ReadonlyMap<string, ComponentBundleInfo>
  readonly violations: BoundaryViolation[]
  /** Файлы, достижимые из браузерных entry (компонентов и `index`). */
  readonly browserFiles: string[]
}

const NODE_BUILTINS = new Set(builtinModules)
const GRANUM_NODE_ENTRY_RE = /^@feugene\/granum\/(?:build|vite|node|codegen)(?:\/|$)/
const CROSS_PROVIDER_RE = /^(@[^/]+\/[^/]+|[^./@][^/]*)\/components\/([^/]+)$/

function isChunk(item: BundleChunkLike | BundleAssetLike | undefined): item is BundleChunkLike {
  return item?.type === 'chunk'
}

/** Обход от entry компонента; чужие entry записываются как рёбра, дальше не идём. */
function walkComponent(
  bundle: BundleLike,
  entryFile: string,
  componentNames: ReadonlySet<string>,
  self: string,
): { files: Set<string>, edges: Set<string> } {
  const files = new Set<string>()
  const edges = new Set<string>()
  const queue = [entryFile]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (files.has(file))
      continue
    const chunk = bundle[file]
    if (!isChunk(chunk))
      continue
    files.add(file)
    for (const spec of [...chunk.imports, ...chunk.dynamicImports]) {
      const target = bundle[spec]
      if (isChunk(target)) {
        // Бандлер импортирует чужой компонент и через его entry, и напрямую
        // через его чанк (`components/<B>/chunks/*`): любой файл чужой
        // директории — ребро графа, а не файл этого компонента.
        const owner = classifyOutputFile(spec)
        if (owner.kind === 'component' && owner.name !== self && componentNames.has(owner.name)) {
          edges.add(owner.name)
          continue
        }
        queue.push(spec)
        continue
      }
      const cross = CROSS_PROVIDER_RE.exec(spec)
      if (cross)
        edges.add(`${cross[1]}:${cross[2]}`)
    }
  }
  return { files, edges }
}

export interface AnalyzeBundleOptions {
  readonly indexEntry?: string
  /** Правила провайдера — учитываются при отборе классов (C-7). */
  readonly rules?: readonly GranumRule[]
  readonly variants?: readonly GranumVariant[]
}

/**
 * `classes` компонента — токены, извлечённые из его файлов, для которых у
 * движка (встроенного плюс правил провайдера) есть правило. Прочие токены
 * кода (`import`, `const`, имена переменных) классами не являются и в
 * манифест не попадают (INV-MAN-5).
 */
export async function analyzeBundle(
  bundle: BundleLike,
  descriptors: readonly GranumComponentDescriptor[],
  engine: GranumEngine,
  options: AnalyzeBundleOptions = {},
): Promise<BundleAnalysis> {
  const componentNames = new Set(descriptors.map(d => d.name))
  const components = new Map<string, ComponentBundleInfo>()
  const browserFiles = new Set<string>()

  for (const descriptor of descriptors) {
    const entryFile = componentEntryFileName(descriptor.name)
    const { files, edges } = walkComponent(bundle, entryFile, componentNames, descriptor.name)
    for (const f of files)
      browserFiles.add(f)

    const candidates = new Set<string>()
    const consumes = new Set<string>()
    const cssAssets = new Set<string>()
    const cssImportedByChunk = new Set<string>()

    for (const file of files) {
      const chunk = bundle[file] as BundleChunkLike
      for (const token of engine.extract(chunk.code, file))
        candidates.add(token)
      const scan = scanTokenConsumption(chunk.code, file)
      for (const name of scan.uses.keys())
        consumes.add(`--${name}`)
      for (const name of scan.literals)
        consumes.add(`--${name}`)
      for (const css of chunk.viteMetadata?.importedCss ?? []) {
        cssAssets.add(css)
        if (chunk.imports.includes(css) || chunk.code.includes(`"${basename(css)}"`) || chunk.code.includes(`'${basename(css)}'`))
          cssImportedByChunk.add(file)
      }
    }
    for (const css of cssAssets) {
      const asset = bundle[css]
      if (asset && asset.type === 'asset' && typeof asset.source === 'string') {
        for (const name of scanTokenConsumption(asset.source, css).uses.keys())
          consumes.add(`--${name}`)
      }
    }
    const generated = await engine.generate({
      classes: candidates,
      ...(options.rules ? { rules: options.rules } : {}),
      ...(options.variants ? { variants: options.variants } : {}),
    })
    const classes = new Set(generated.matched.keys())
    // Классы, собранные в рантайме, статикой не считаются — их несёт safelist (C-8).
    components.set(descriptor.name, {
      name: descriptor.name,
      files: sortedUnique(files),
      cssAssets: sortedUnique(cssAssets),
      classes: sortedUnique(classes),
      consumes: sortedUnique(consumes),
      edges: sortedUnique(edges),
      cssImportedByChunk: sortedUnique(cssImportedByChunk),
    })
  }

  if (options.indexEntry && isChunk(bundle[options.indexEntry])) {
    const queue = [options.indexEntry]
    while (queue.length > 0) {
      const file = queue.pop()!
      if (browserFiles.has(file))
        continue
      const chunk = bundle[file]
      if (!isChunk(chunk))
        continue
      browserFiles.add(file)
      for (const spec of [...chunk.imports, ...chunk.dynamicImports]) {
        if (isChunk(bundle[spec]))
          queue.push(spec)
      }
    }
  }

  const violations: BoundaryViolation[] = []
  for (const file of [...browserFiles].sort()) {
    const chunk = bundle[file] as BundleChunkLike
    for (const spec of [...chunk.imports, ...chunk.dynamicImports]) {
      if (isChunk(bundle[spec]))
        continue
      if (spec.startsWith('node:') || NODE_BUILTINS.has(spec))
        violations.push({ file, specifier: spec, kind: 'node-import' })
      else if (GRANUM_NODE_ENTRY_RE.test(spec))
        violations.push({ file, specifier: spec, kind: 'granum-node-entry' })
    }
    if (chunk.code.includes('data:text/css'))
      violations.push({ file, specifier: 'data:text/css', kind: 'data-url' })
  }

  return { components, violations, browserFiles: [...browserFiles].sort() }
}

function basename(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1)
}

/**
 * Рёбра, не покрытые объявленным графом (INV-CON-5). Покрытие — транзитивное
 * замыкание `dependencies` внутри провайдера; кросс-провайдерные ключи
 * сравниваются как есть.
 */
export function findUndeclaredEdges(
  providerId: string,
  descriptors: readonly GranumComponentDescriptor[],
  analysis: BundleAnalysis,
): (readonly [from: string, to: string])[] {
  const byName = new Map(descriptors.map(d => [d.name, d]))
  const closureOf = (root: string): Set<string> => {
    const seen = new Set<string>()
    const queue = [root]
    while (queue.length > 0) {
      const name = queue.pop()!
      const descriptor = byName.get(name)
      if (!descriptor)
        continue
      for (const dep of descriptor.dependencies ?? []) {
        for (const key of normalizeDependency(dep, providerId)) {
          if (seen.has(key))
            continue
          seen.add(key)
          const [pkg, depName] = [key.slice(0, key.lastIndexOf(':')), key.slice(key.lastIndexOf(':') + 1)]
          if (pkg === providerId)
            queue.push(depName)
        }
      }
    }
    return seen
  }

  const undeclared: (readonly [string, string])[] = []
  for (const descriptor of descriptors) {
    const info = analysis.components.get(descriptor.name)
    if (!info)
      continue
    const covered = closureOf(descriptor.name)
    for (const edge of info.edges) {
      const key = edge.includes(':') ? edge : `${providerId}:${edge}`
      if (!covered.has(key))
        undeclared.push([descriptor.name, key])
    }
  }
  return undeclared
}
