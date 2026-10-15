/**
 * Разбор CSS с токенами темы в `{ selector, tokens }`.
 * Поддерживаются только ПЛОСКИЕ блоки верхнего уровня: вложенные и блоки
 * внутри at-rules парой «селектор → токены» не выражаются и в strict-режиме
 * дают ошибку, а не тихо пустую тему.
 *
 * Блоки и значения читает `scanCssBlocks`: значение токена вправе содержать
 * `;`, скобки и кавычки (`url(data:…;base64,…)`, `"a;b"`), и берётся целиком.
 * Блоки с одним селектором объединяются, последнее объявление побеждает — как
 * в каскаде.
 */
import type { GranumTokenSet } from '../contract'
import type { CssBlock } from './cssDeclarations'
import { TokenParseError } from '../core/errors'
import { stripComments, stripCssComments } from '../engine/extract'
import { isCssDataUrl, readCss, readCssSync, resolveCssFilePath } from './css'
import { scanCssBlocks } from './cssDeclarations'

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
  // `/*` — комментарий в начале CSS-текста, а не абсолютный путь.
  if ((source.startsWith('/') && source[1] !== '*') || /^[a-z]:[\\/]/i.test(source))
    return false
  return source.includes('{')
}

export interface SkippedBlock {
  readonly path: readonly string[]
  readonly reason: 'at-rule' | 'nested'
}

function extractBlocksDetailed(css: string): { blocks: ParsedTokenBlock[], skipped: SkippedBlock[] } {
  const bySelector = new Map<string, Record<string, string>>()
  const skipped: SkippedBlock[] = []

  const visit = (block: CssBlock, parents: readonly string[]): void => {
    const path = [...parents, cleanPrelude(block.prelude)]
    const tokens = ownTokens(block)
    if (Object.keys(tokens).length > 0) {
      if (path.some(p => p.startsWith('@')))
        skipped.push({ path, reason: 'at-rule' })
      else if (parents.length > 0)
        skipped.push({ path, reason: 'nested' })
      else if (path[0])
        bySelector.set(path[0], { ...bySelector.get(path[0]), ...tokens })
    }
    for (const child of block.children)
      visit(child, path)
  }
  for (const block of scanCssBlocks(css).blocks)
    visit(block, [])

  return { blocks: [...bySelector].map(([selector, tokens]) => ({ selector, tokens })), skipped }
}

/** Прелюдия без комментариев: `scanCssBlocks` захватывает в неё комментарий перед селектором. */
function cleanPrelude(prelude: string): string {
  return stripCssComments(prelude, 'space').trim().replace(/\s+/g, ' ')
}

/** Собственные объявления блока; комментарий внутри значения срезается с учётом строк. */
function ownTokens(block: CssBlock): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const decl of block.declarations) {
    const value = stripComments(decl.value, 'value.css').trim()
    if (value)
      tokens[decl.token] = value
  }
  return tokens
}

function describeSkipped(skipped: readonly SkippedBlock[]): string {
  return skipped
    .map(s => `${JSON.stringify(s.path.join(' > '))} (${s.reason === 'at-rule' ? 'inside an at-rule' : 'nested block'})`)
    .join(', ')
}

function truncate(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
