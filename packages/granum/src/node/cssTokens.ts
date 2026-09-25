/**
 * Разбор CSS с токенами темы в `{ selector, tokens }` (C-13, INV-THM-6).
 * Поддерживаются только ПЛОСКИЕ блоки верхнего уровня: вложенные и блоки
 * внутри at-rules парой «селектор → токены» не выражаются и в strict-режиме
 * дают ошибку, а не тихо пустую тему.
 */
import type { GranumTokenSet } from '../contract'
import { TokenParseError } from '../core/errors'
import { isCssDataUrl, readCss, readCssSync, resolveCssFilePath } from './css'

export interface ParsedTokenBlock {
  readonly selector: string
  /** Ключи БЕЗ `--`. */
  readonly tokens: Record<string, string>
}

export interface TokenSetFromCssOptions {
  /** Какой селектор извлечь. По умолчанию `:root`; единственный блок берётся и без совпадения. */
  readonly selector?: string
  /** Под каким селектором отдать результат. */
  readonly as?: string
  /** Строгий режим (по умолчанию `true`): нет токенов, нет селектора или неподдерживаемые блоки — ошибка. */
  readonly strict?: boolean
}

const DEFAULT_SELECTOR = ':root'

export async function tokenSetFromCss(source: string, options: TokenSetFromCssOptions = {}): Promise<GranumTokenSet> {
  const css = await readCss(isCssDataUrl(source) ? source : resolveCssFilePath(source))
  return parseAndPick(css, source, options)
}

export function tokenSetFromCssSync(source: string, options: TokenSetFromCssOptions = {}): GranumTokenSet {
  const css = readCssSync(isCssDataUrl(source) ? source : resolveCssFilePath(source))
  return parseAndPick(css, source, options)
}

/** Все плоские блоки с custom properties; вход — CSS-текст или источник (путь / URL). */
export function parseCssTokenBlocks(source: string): ParsedTokenBlock[] {
  const css = looksLikeCssLiteral(source) ? source : readCssSync(isCssDataUrl(source) ? source : resolveCssFilePath(source))
  return extractBlocksDetailed(css).blocks
}

/** Только текст: без обращения к FS. */
export function parseCssTokenBlocksFromText(css: string): { blocks: ParsedTokenBlock[], skipped: SkippedBlock[] } {
  return extractBlocksDetailed(css)
}

function parseAndPick(css: string, source: string, options: TokenSetFromCssOptions): GranumTokenSet {
  const { selector = DEFAULT_SELECTOR, as, strict = true } = options
  const { blocks, skipped } = extractBlocksDetailed(css)

  if (skipped.length > 0 && strict) {
    throw new TokenParseError(
      `Unsupported CSS block(s) in ${truncate(source)}: ${describeSkipped(skipped)}. `
      + 'Only flat top-level blocks are parsed; move the custom properties to a top-level selector.',
      source,
      'unsupported-blocks',
    )
  }

  if (blocks.length === 0) {
    if (strict)
      throw new TokenParseError(`No CSS custom properties found in ${truncate(source)}`, source, 'no-tokens')
    return { selector: as ?? selector, tokens: {} }
  }

  let picked = blocks.find(b => b.selector === selector)
  if (!picked) {
    if (blocks.length === 1 || !strict) {
      picked = blocks[0]!
    }
    else {
      throw new TokenParseError(
        `Selector "${selector}" not found in ${truncate(source)}; available selectors: ${blocks.map(b => JSON.stringify(b.selector)).join(', ')}`,
        source,
        'selector-not-found',
        blocks.map(b => b.selector),
      )
    }
  }

  return { selector: as ?? picked.selector, tokens: picked.tokens }
}

function looksLikeCssLiteral(source: string): boolean {
  if (isCssDataUrl(source) || /^[a-z]+:\/\//i.test(source))
    return false
  if (source.startsWith('/') || /^[a-z]:[\\/]/i.test(source))
    return false
  return source.includes('{')
}

const DECL_RE = /--([\w-]+)\s*:([^;]*)(?:;|$)/g

export interface SkippedBlock {
  readonly path: readonly string[]
  readonly reason: 'at-rule' | 'nested'
}

function extractBlocksDetailed(rawCss: string): { blocks: ParsedTokenBlock[], skipped: SkippedBlock[] } {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks: ParsedTokenBlock[] = []
  const skipped: SkippedBlock[] = []
  const stack: Array<{ prelude: string, body: string[] }> = []
  let chunkStart = 0

  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch !== '{' && ch !== '}')
      continue

    if (ch === '{') {
      const raw = css.slice(chunkStart, i)
      const cut = raw.lastIndexOf(';')
      if (cut >= 0)
        stack[stack.length - 1]?.body.push(raw.slice(0, cut + 1))
      stack.push({ prelude: raw.slice(cut + 1).trim().replace(/\s+/g, ' '), body: [] })
      chunkStart = i + 1
      continue
    }

    const level = stack.pop()
    if (!level)
      break
    level.body.push(css.slice(chunkStart, i))
    chunkStart = i + 1

    const tokens: Record<string, string> = {}
    for (const decl of level.body.join(';').matchAll(DECL_RE)) {
      const value = decl[2]!.trim()
      if (value)
        tokens[decl[1]!] = value
    }
    if (Object.keys(tokens).length === 0)
      continue

    const path = [...stack.map(l => l.prelude), level.prelude]
    if (path.some(p => p.startsWith('@')))
      skipped.push({ path, reason: 'at-rule' })
    else if (stack.length > 0)
      skipped.push({ path, reason: 'nested' })
    else if (level.prelude)
      blocks.push({ selector: level.prelude, tokens })
  }

  return { blocks, skipped }
}

function describeSkipped(skipped: readonly SkippedBlock[]): string {
  return skipped
    .map(s => `${JSON.stringify(s.path.join(' > '))} (${s.reason === 'at-rule' ? 'inside an at-rule' : 'nested block'})`)
    .join(', ')
}

function truncate(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
