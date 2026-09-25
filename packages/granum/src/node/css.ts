/**
 * Чтение CSS: локальные пути, `file:` и `data:text/css` URL. Кэш по
 * (mtime, size) с LRU-вытеснением — dev-сервер читает одни и те же файлы тем
 * на каждую регенерацию.
 */
import { Buffer } from 'node:buffer'
import { readFileSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { CssSourceError } from '../core/errors'

const DATA_URL_PREFIX = 'data:text/css'

export function isCssDataUrl(source: string): boolean {
  return source.startsWith(DATA_URL_PREFIX)
}

/** data URL / `file:` URL / абсолютный / относительный путь → абсолютный путь или data URL. */
export function resolveCssFilePath(source: string, cwd: string = process.cwd()): string {
  if (isCssDataUrl(source))
    return source
  if (/^[a-z]+:\/\//i.test(source)) {
    const url = new URL(source)
    if (url.protocol === 'file:')
      return fileURLToPath(url)
    throw new CssSourceError(source, 'unsupported-protocol')
  }
  if (isAbsolute(source))
    return source
  return resolve(cwd, source)
}

export function decodeCssDataUrl(source: string): string {
  const match = source.match(/^data:([^,]*),(.*)$/s)
  if (!match)
    throw new CssSourceError(source, 'invalid-data-url')
  const [, metadata = '', body = ''] = match
  if (metadata.includes(';base64'))
    return Buffer.from(body, 'base64').toString('utf8')
  return decodeURIComponent(body)
}

interface CssCacheEntry {
  mtimeMs: number
  size: number
  content: string
}

export const CSS_CACHE_MAX_ENTRIES = 512
const cssCache = new Map<string, CssCacheEntry>()

export function clearCssCache(): void {
  cssCache.clear()
}

export function getCssCacheSize(): number {
  return cssCache.size
}

function cacheSet(file: string, entry: CssCacheEntry): void {
  cssCache.delete(file)
  cssCache.set(file, entry)
  while (cssCache.size > CSS_CACHE_MAX_ENTRIES) {
    const oldest = cssCache.keys().next()
    if (oldest.done)
      break
    cssCache.delete(oldest.value)
  }
}

function fromCache(file: string, mtimeMs: number, size: number): string | undefined {
  const cached = cssCache.get(file)
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    cssCache.delete(file)
    cssCache.set(file, cached)
    return cached.content
  }
  return undefined
}

export async function readCss(file: string): Promise<string> {
  if (isCssDataUrl(file))
    return decodeCssDataUrl(file)
  let stats
  try {
    stats = await stat(file)
  }
  catch {
    return readFile(file, 'utf8')
  }
  const hit = fromCache(file, stats.mtimeMs, stats.size)
  if (hit !== undefined)
    return hit
  const content = await readFile(file, 'utf8')
  cacheSet(file, { mtimeMs: stats.mtimeMs, size: stats.size, content })
  return content
}

export function readCssSync(file: string): string {
  if (isCssDataUrl(file))
    return decodeCssDataUrl(file)
  let stats
  try {
    stats = statSync(file)
  }
  catch {
    return readFileSync(file, 'utf8')
  }
  const hit = fromCache(file, stats.mtimeMs, stats.size)
  if (hit !== undefined)
    return hit
  const content = readFileSync(file, 'utf8')
  cacheSet(file, { mtimeMs: stats.mtimeMs, size: stats.size, content })
  return content
}
