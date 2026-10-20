/**
 * Блоки CSS активной темы и превью из значений резолюции (T-8…T-13, A-32).
 * Селекторы назначает активация: тема — данные, своих селекторов у неё нет.
 *
 * Раскладка:
 *   - слой `tokens`: `:root { литералы root }`;
 *   - слой `themes`: `:root, [attr] { формулы }` — режимонезависимые со ссылкой
 *     `var(` и режимные, одинаковые во всех режимах; затем режим по умолчанию
 *     под `:root, [attr="пара"]`, остальные под `[attr="пара"]`, фолбэки
 *     `@supports`, блок `prefers-color-scheme` и превью-темы.
 *
 * Формула под `[attr]` пересчитывается на каждом острове: под одним `:root` она
 * вычислилась бы по ролям корня и унаследовалась бы островом готовой.
 */
import type { GranumResolution } from '../core/resolve'
import type { ResolvedMode } from '../core/resolveThemes'
import type { ThemeTokenSet, TokenChain } from '../core/tokenLayers'

export interface ThemeCss {
  /** `:root { … }` с литералами root активной темы — в слой `tokens`. */
  readonly tokens: string | undefined
  /** CSS режимонезависимого базового уровня тем (`baseCss` данных) — в слой `base`. */
  readonly base: readonly string[]
  /** Блоки слоя `themes` по порядку. */
  readonly themes: readonly string[]
  /**
   * Те же блоки слоя `themes`, разложенные по владельцу: общий блок активной
   * темы, режим (его блок, фолбэки, медиазапрос системной схемы) и тема превью.
   * Порядок слоя от раскладки не меняется.
   */
  readonly parts: ThemeCssParts
}

export interface ThemeCssParts {
  readonly shared: readonly string[]
  readonly modes: readonly { readonly name: string, readonly blocks: readonly string[] }[]
  readonly previews: readonly { readonly id: string, readonly blocks: readonly string[] }[]
}

type Keep = (token: string) => boolean

const isFormula = (value: string): boolean => value.includes('var(')

function attributeSelector(attribute: string, value?: string, operator = '='): string {
  return value === undefined ? `[${attribute}]` : `[${attribute}${operator}"${value.replace(/["\\]/g, '\\$&')}"]`
}

/** Объявления блока: `color-scheme` первым, токены по имени. */
function serializeBlock(selector: string, chains: Iterable<TokenChain>, keep: Keep, colorScheme?: string, indent = ''): string | undefined {
  const lines = [...chains]
    .filter(chain => chain.effective !== undefined && keep(chain.token))
    .sort((a, b) => a.token.localeCompare(b.token, 'en'))
    .map(chain => `${indent}  --${chain.token}: ${chain.effective};`)
  if (colorScheme !== undefined)
    lines.unshift(`${indent}  color-scheme: ${colorScheme};`)
  if (lines.length === 0)
    return undefined
  return `${indent}${selector} {\n${lines.join('\n')}\n${indent}}`
}

/**
 * Режимные формулы, одинаковые во всех режимах: выводятся один раз под общей
 * границей (T-10), а не в каждом блоке режима.
 */
function sharedFormulas(set: ThemeTokenSet): Set<string> {
  const modes = [...set.modes.values()]
  const shared = new Set<string>()
  if (modes.length === 0)
    return shared
  for (const [token, chain] of modes[0]!) {
    const value = chain.effective
    if (value !== undefined && isFormula(value) && modes.every(mode => mode.get(token)?.effective === value))
      shared.add(token)
  }
  return shared
}

interface SetBlocks {
  readonly rootLiterals: TokenChain[]
  readonly shared: TokenChain[]
  readonly modeChains: (mode: string) => TokenChain[]
}

function splitSet(set: ThemeTokenSet): SetBlocks {
  const hoisted = sharedFormulas(set)
  const rootLiterals: TokenChain[] = []
  const shared: TokenChain[] = []
  for (const chain of set.root.values()) {
    if (chain.effective === undefined)
      continue
    if (isFormula(chain.effective))
      shared.push(chain)
    else
      rootLiterals.push(chain)
  }
  const first = set.modes.values().next().value
  for (const token of hoisted)
    shared.push(first!.get(token)!)
  return {
    rootLiterals,
    shared,
    modeChains: mode => [...(set.modes.get(mode)?.values() ?? [])].filter(chain => !hoisted.has(chain.token)),
  }
}

function fallbackBlocks(set: ThemeTokenSet, mode: ResolvedMode, selector: string, keep: Keep): string[] {
  const out: string[] = []
  for (const block of set.fallbacks.get(mode.name) ?? []) {
    const inner = serializeBlock(selector, block.tokens.values(), keep, undefined, '  ')
    if (inner !== undefined)
      out.push(`@supports ${block.supports} {\n${inner}\n}`)
  }
  return out
}

export function emitThemeCss(resolution: GranumResolution, keep: Keep = () => true): ThemeCss {
  const { themes, tokens } = resolution
  const attribute = themes.activation.attribute
  const base: string[] = []
  const blocks: string[] = []
  const shared: string[] = []
  const modeParts: { name: string, blocks: string[] }[] = []
  const previewParts: { id: string, blocks: string[] }[] = []
  let tokensBlock: string | undefined
  const push = (part: string[], ...css: string[]): void => {
    blocks.push(...css)
    part.push(...css)
  }

  const addBase = (css: readonly string[] | undefined): void => {
    for (const text of css ?? []) {
      if (!base.includes(text))
        base.push(text)
    }
  }

  const active = tokens.active
  if (themes.theme && active) {
    addBase(themes.theme.data.baseCss)
    const split = splitSet(active)
    tokensBlock = serializeBlock(':root', split.rootLiterals, keep)
    const common = serializeBlock(`:root, ${attributeSelector(attribute)}`, split.shared, keep)
    if (common)
      push(shared, common)
    const selectorOf = (mode: ResolvedMode): string => {
      const own = attributeSelector(attribute, mode.value)
      return mode.name === themes.defaultMode ? `:root, ${own}` : own
    }
    const partOf = (name: string): string[] => modeParts.find(part => part.name === name)!.blocks
    for (const mode of themes.modes)
      modeParts.push({ name: mode.name, blocks: [] })
    for (const mode of themes.modes) {
      const block = serializeBlock(selectorOf(mode), split.modeChains(mode.name), keep, mode.colorScheme)
      if (block)
        push(partOf(mode.name), block)
    }
    for (const mode of themes.modes)
      push(partOf(mode.name), ...fallbackBlocks(active, mode, selectorOf(mode), keep))
    if (themes.system === 'media') {
      const dark = themes.modes.find(mode => mode.colorScheme === 'dark')
      const inner = dark ? serializeBlock(`:root:not(${attributeSelector(attribute)})`, split.modeChains(dark.name), keep, 'dark', '  ') : undefined
      if (dark && inner)
        push(partOf(dark.name), `@media (prefers-color-scheme: dark) {\n${inner}\n}`)
    }
  }

  // Превью — полные блоки пар и никогда под `:root` (A-32).
  for (const [i, preview] of themes.previews.entries()) {
    const set = tokens.previews[i]!
    addBase(preview.theme.data.baseCss)
    const split = splitSet(set)
    const part: string[] = []
    previewParts.push({ id: preview.theme.id, blocks: part })
    // Общая граница превью — пары темы по префиксу шаблона. Шаблон, где режим
    // стоит раньше темы, префикса не даёт: тогда формулы идут в блок каждой пары.
    const template = themes.activation.value
    const prefix = template.slice(0, template.indexOf('{mode}')).replaceAll('{theme}', preview.theme.id)
    const common = prefix ? serializeBlock(attributeSelector(attribute, prefix, '^='), split.shared, keep) : undefined
    if (common)
      push(part, common)
    for (const mode of preview.modes) {
      const chains = [...split.rootLiterals, ...(prefix ? [] : split.shared), ...split.modeChains(mode.name)]
      const block = serializeBlock(attributeSelector(attribute, mode.value), chains, keep, mode.colorScheme)
      if (block)
        push(part, block)
    }
    for (const mode of preview.modes)
      push(part, ...fallbackBlocks(set, mode, attributeSelector(attribute, mode.value), keep))
  }

  return { tokens: tokensBlock, base, themes: blocks, parts: { shared, modes: modeParts, previews: previewParts } }
}
