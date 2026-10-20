/**
 * Блоки CSS тем сборки из значений резолюции.
 * Селекторы назначает активация: тема — данные, своих селекторов у неё нет.
 *
 * Раскладка основной темы:
 *   - слой `tokens`: `:root:not([attr]), <её пары> { литералы root }`;
 *   - слой `themes`: `:where(:root), <её пары> { формулы }` — режимонезависимые
 *     со ссылкой `var(` и режимные, одинаковые во всех режимах; затем режим по
 *     умолчанию под `:where(:root), [attr="пара"]`, остальные под
 *     `[attr="пара"]`, фолбэки `@supports` (у режима по умолчанию — под
 *     `:root:not([attr])` и парой), блок `prefers-color-scheme`.
 *
 * Дополнительная тема — полные блоки своих пар, без `:root`: они уходят в её лист.
 *
 * Формула под парой пересчитывается на каждом острове: под одним `:root` она
 * вычислилась бы по ролям корня и унаследовалась бы островом готовой. `:root`
 * основной темы — под `:where()`: пара любой темы на корне перекрывает её
 * специфичностью, и каскад не зависит от порядка листов.
 *
 * Литералы `root` основной темы — в слое `tokens` рядом с `tokensCss` провайдеров
 * и обязаны перекрывать их, поэтому `:where()` им не годится. Они выходят под
 * корнем без атрибута и парами основной темы: корень с парой другой темы их не
 * получает (иначе без слоёв решал бы порядок листов), а остров основной темы
 * внутри него — получает, а не наследует литералы чужой темы от корня.
 */
import type { GranumResolution } from '../core/resolve'
import type { ResolvedBuildTheme, ResolvedMode } from '../core/resolveThemes'
import type { ThemeTokenSet, TokenChain } from '../core/tokenLayers'

export interface ThemeCss {
  /** `:root:not([attr]), <пары основной> { … }` с литералами root основной темы — в слой `tokens`. */
  readonly tokens: string | undefined
  /** `baseCss` основной темы — в слой `base` общего листа. */
  readonly base: readonly string[]
  /** Блоки слоя `themes` основной темы по порядку. */
  readonly themes: readonly string[]
  /**
   * Те же блоки, разложенные по владельцу: общий блок основной темы и режим
   * (его блок, фолбэки, медиазапрос системной схемы). Порядок слоя от раскладки
   * не меняется.
   */
  readonly parts: ThemeCssParts
  /** Дополнительные темы в порядке `themes`: каждая — своим листом. */
  readonly additional: readonly AdditionalThemeCss[]
}

export interface ThemeCssParts {
  readonly shared: readonly string[]
  readonly modes: readonly { readonly name: string, readonly blocks: readonly string[] }[]
}

/** Лист дополнительной темы: слои `base` и `themes`. */
export interface AdditionalThemeCss {
  readonly id: string
  /** `baseCss` темы, кроме записей, которые уже несёт общий лист. */
  readonly base: readonly string[]
  readonly themes: readonly string[]
}

type Keep = (token: string) => boolean

const isFormula = (value: string): boolean => value.includes('var(')

function attributeSelector(attribute: string, value?: string): string {
  return value === undefined ? `[${attribute}]` : `[${attribute}="${value.replace(/["\\]/g, '\\$&')}"]`
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
 * границей, а не в каждом блоке режима.
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

function fallbackBlocks(set: ThemeTokenSet, mode: ResolvedMode, selector: string, keep: Keep, indent = ''): string[] {
  const out: string[] = []
  for (const block of set.fallbacks.get(mode.name) ?? []) {
    const inner = serializeBlock(selector, block.tokens.values(), keep, undefined, `${indent}  `)
    if (inner !== undefined)
      out.push(`${indent}@supports ${block.supports} {\n${inner}\n${indent}}`)
  }
  return out
}

/** Пары режимов темы — граница её общего блока. Префикс значения границей служить не может. */
function pairsSelector(attribute: string, entry: ResolvedBuildTheme): string {
  return entry.modes.map(mode => attributeSelector(attribute, mode.value)).join(', ')
}

/** Полные блоки пар дополнительной темы — без `:root`. */
function additionalBlocks(entry: ResolvedBuildTheme, set: ThemeTokenSet, attribute: string, keep: Keep): string[] {
  const split = splitSet(set)
  const blocks: string[] = []
  // Префикс значения совпал бы и с парами другой темы: `slate-` — с
  // `slate-hc-light`, статика шаблона перед режимом — со всеми парами.
  const common = entry.modes.length > 0 ? serializeBlock(pairsSelector(attribute, entry), split.shared, keep) : undefined
  if (common)
    blocks.push(common)
  for (const mode of entry.modes) {
    const chains = [...split.rootLiterals, ...split.modeChains(mode.name)]
    const block = serializeBlock(attributeSelector(attribute, mode.value), chains, keep, mode.colorScheme)
    if (block)
      blocks.push(block)
  }
  for (const mode of entry.modes)
    blocks.push(...fallbackBlocks(set, mode, attributeSelector(attribute, mode.value), keep))
  return blocks
}

export function emitThemeCss(resolution: GranumResolution, keep: Keep = () => true): ThemeCss {
  const { themes, tokens } = resolution
  const attribute = themes.activation.attribute
  const base: string[] = []
  const blocks: string[] = []
  const shared: string[] = []
  const modeParts: { name: string, blocks: string[] }[] = []
  let tokensBlock: string | undefined
  const push = (part: string[], ...css: string[]): void => {
    blocks.push(...css)
    part.push(...css)
  }

  const main = themes.default
  const mainSet = tokens.default
  if (main && mainSet) {
    for (const text of main.theme.data.baseCss ?? []) {
      if (!base.includes(text))
        base.push(text)
    }
    const split = splitSet(mainSet)
    const bareRoot = `:root:not(${attributeSelector(attribute)})`
    const pairs = main.modes.length > 0 ? [pairsSelector(attribute, main)] : []
    tokensBlock = serializeBlock([bareRoot, ...pairs].join(', '), split.rootLiterals, keep)
    const boundary = [':where(:root)', ...pairs].join(', ')
    const common = serializeBlock(boundary, split.shared, keep)
    if (common)
      push(shared, common)
    const selectorOf = (mode: ResolvedMode): string => {
      const own = attributeSelector(attribute, mode.value)
      return mode.name === main.defaultMode ? `:where(:root), ${own}` : own
    }
    // Фолбэки идут после всех режимов: под голым `:root` фолбэк режима по
    // умолчанию достал бы корень с другой парой. Корень без атрибута — тот же,
    // что у блока системной схемы.
    const fallbackSelectorOf = (mode: ResolvedMode): string => {
      const own = attributeSelector(attribute, mode.value)
      return mode.name === main.defaultMode ? `${bareRoot}, ${own}` : own
    }
    const partOf = (name: string): string[] => modeParts.find(part => part.name === name)!.blocks
    for (const mode of main.modes)
      modeParts.push({ name: mode.name, blocks: [] })
    for (const mode of main.modes) {
      const block = serializeBlock(selectorOf(mode), split.modeChains(mode.name), keep, mode.colorScheme)
      if (block)
        push(partOf(mode.name), block)
    }
    for (const mode of main.modes)
      push(partOf(mode.name), ...fallbackBlocks(mainSet, mode, fallbackSelectorOf(mode), keep))
    const dark = themes.system === 'media' ? main.modes.find(mode => mode.colorScheme === 'dark') : undefined
    if (dark) {
      // Фолбэки тёмного режима — внутри того же медиазапроса: под парой они
      // корень без атрибута не достают, а блок схемы перебивает фолбэк корня.
      const inner = [
        serializeBlock(bareRoot, split.modeChains(dark.name), keep, 'dark', '  ')!,
        ...fallbackBlocks(mainSet, dark, bareRoot, keep, '  '),
      ]
      push(partOf(dark.name), `@media (prefers-color-scheme: dark) {\n${inner.join('\n')}\n}`)
    }
  }

  const additional = themes.themes.flatMap((entry, i): AdditionalThemeCss[] => {
    if (entry.isDefault)
      return []
    const own = (entry.theme.data.baseCss ?? []).filter((text, at, all) => !base.includes(text) && all.indexOf(text) === at)
    return [{ id: entry.theme.id, base: own, themes: additionalBlocks(entry, tokens.themes[i]!, attribute, keep) }]
  })

  return { tokens: tokensBlock, base, themes: blocks, parts: { shared, modes: modeParts }, additional }
}
