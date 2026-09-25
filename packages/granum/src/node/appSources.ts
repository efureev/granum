/**
 * Скан исходников приложения (A-3, A-11, T-2): классы для движка, потребление
 * токенов, импорты компонентов провайдеров. Директории, не globs: обход
 * рекурсивный, расширения — параметр.
 */
import type { GranumAppSources } from '../config'
import type { GranumEngine } from '../engine/types'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { sortedUnique } from '../core/dedupe'
import { scanTokenConsumption } from './tokenScan'

export const DEFAULT_APP_EXTENSIONS = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'vue', 'svelte', 'astro', 'html', 'css'] as const

export interface AppSourcesScan {
  readonly files: readonly string[]
  readonly classes: readonly string[]
  /** Потребляемые токены, с `--`. */
  readonly consumes: readonly string[]
  /** Импорты вида `<pkg>/components/<Name>`: ключи `pkg:Name`. */
  readonly componentImports: readonly string[]
}

const COMPONENT_IMPORT_RE = /["'](@[^/"']+\/[^/"']+|[^./@"'][^/"']*)\/components\/([A-Z][\w-]*)["']/g

export function listSourceFiles(dir: string, extensions: readonly string[]): string[] {
  const allowed = new Set(extensions.map(e => `.${e}`))
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && allowed.has(extname(entry.name)) && !entry.parentPath.split(/[\\/]/).includes('node_modules'))
      .map(entry => join(entry.parentPath, entry.name))
      .sort()
  }
  catch {
    return []
  }
}

export function scanAppSources(config: GranumAppSources | undefined, root: string, engine: GranumEngine): AppSourcesScan {
  if (!config)
    return { files: [], classes: [], consumes: [], componentImports: [] }
  const extensions = config.extensions ?? DEFAULT_APP_EXTENSIONS
  const files: string[] = []
  const classes = new Set<string>()
  const consumes = new Set<string>()
  const imports = new Set<string>()

  for (const dir of config.dirs) {
    for (const file of listSourceFiles(resolve(root, dir), extensions)) {
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      }
      catch {
        continue
      }
      files.push(file)
      if (!file.endsWith('.css')) {
        for (const token of engine.extract(text, file))
          classes.add(token)
        for (const m of text.matchAll(COMPONENT_IMPORT_RE))
          imports.add(`${m[1]}:${m[2]}`)
      }
      const scan = scanTokenConsumption(text, file)
      for (const name of scan.uses.keys())
        consumes.add(`--${name}`)
      for (const name of scan.literals)
        consumes.add(`--${name}`)
    }
  }

  return { files, classes: sortedUnique(classes), consumes: sortedUnique(consumes), componentImports: sortedUnique(imports) }
}
