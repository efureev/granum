/**
 * Единственный источник правды о значениях токенов: какие
 * слои писали каждый токен в каждом режиме, в каком порядке и что уедет в
 * CSS. Из него сериализуется CSS и считаются отчёты, `granum tokens` и
 * обрезка — расходиться им негде.
 */
import type { ComponentNode } from './providerNode'
import type { ResolvedBuildTheme, ResolvedMode, ResolvedTheme, ResolvedThemes } from './resolveThemes'
import { APP_THEME_SOURCE, componentModeSequence } from './resolveThemes'
import { DEFAULT_MODE, modeChain } from './themeData'

/**
 * Слой значения, по порядку применения: данные темы, токены компонента,
 * тема-объект приложения, режим `define`, override приложения.
 */
export type TokenLayerSource = 'theme' | 'component' | 'app-theme' | 'app-mode' | 'app-override'

export interface TokenLayerValue {
  readonly source: TokenLayerSource
  readonly value: string
  /** Тема, из данных или токенов компонента которой пришло значение. */
  readonly theme?: string
  /**
   * Режим, из которого взято значение: сам режим, предок по `extends`, режим по
   * умолчанию или `root` — режимонезависимое.
   */
  readonly mode?: string
  /** Квалифицированный ключ компонента-автора — только у `component`. */
  readonly componentKey?: string
  /** Слой написан, но отброшен `strictTokens` и в CSS не уехал. */
  readonly skipped?: 'strict-tokens'
}

export interface TokenChain {
  readonly token: string
  /** Режим или `root`. */
  readonly scope: string
  /** Все написанные слои в порядке применения, включая пропущенные. */
  readonly layers: TokenLayerValue[]
  /** Значение последнего непропущенного слоя; `undefined` — токена в CSS нет. */
  effective?: string
}

export interface FallbackBlock {
  readonly supports: string
  readonly tokens: Map<string, TokenChain>
}

/** Значения одной темы: режимонезависимые и по режимам в порядке эмиссии. */
export interface ThemeTokenSet {
  readonly themeId: string
  readonly root: Map<string, TokenChain>
  readonly modes: Map<string, Map<string, TokenChain>>
  readonly fallbacks: Map<string, readonly FallbackBlock[]>
}

export interface ResolvedTokens {
  /** Значения основной темы; `undefined` — тем нет. */
  readonly default: ThemeTokenSet | undefined
  /** Значения каждой темы сборки в порядке `ResolvedThemes.themes`. */
  readonly themes: readonly ThemeTokenSet[]
}

export interface CollectTokenLayersOptions {
  readonly onSkippedOverride?: (theme: string, scope: string, token: string) => void
}

function push(map: Map<string, TokenChain>, scope: string, token: string, layer: TokenLayerValue): void {
  let chain = map.get(token)
  if (!chain) {
    chain = { token, scope, layers: [] }
    map.set(token, chain)
  }
  chain.layers.push(layer)
  if (!layer.skipped)
    chain.effective = layer.value
}

function ensure<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key)
  if (value === undefined) {
    value = create()
    map.set(key, value)
  }
  return value
}

/** Итоговые токены режима темы с режимом-источником каждого значения. */
function modeValues(theme: ResolvedTheme, mode: string): Map<string, { value: string, mode: string }> {
  const out = new Map<string, { value: string, mode: string }>()
  for (const name of [...modeChain(theme.data, mode).names].reverse()) {
    for (const [token, value] of Object.entries(theme.data.modes[name]?.tokens ?? {}))
      out.set(token, { value, mode: name })
  }
  return out
}

/**
 * Данные темы: `root`, затем каждый режим по цепочке `extends` и недостающее —
 * из режима по умолчанию. Недостающее — запасной вариант: значение,
 * которое режиму уже дал другой слой (токены компонента под темой-объектом
 * приложения), им не перекрывается.
 */
function applyThemeData(set: ThemeTokenSet, theme: ResolvedTheme, modeNames: readonly string[], source: 'theme' | 'app-theme'): void {
  for (const [token, value] of Object.entries(theme.data.root))
    push(set.root, 'root', token, { source, value, theme: theme.id, mode: 'root' })
  const defaults = modeValues(theme, theme.data.defaultMode ?? DEFAULT_MODE)
  for (const mode of modeNames) {
    const target = ensure(set.modes, mode, () => new Map<string, TokenChain>())
    const own = modeValues(theme, mode)
    for (const [token, found] of defaults) {
      if (!own.has(token) && !target.has(token))
        push(target, mode, token, { source, value: found.value, theme: theme.id, mode: found.mode })
    }
    for (const [token, found] of own)
      push(target, mode, token, { source, value: found.value, theme: theme.id, mode: found.mode })
  }
}

/**
 * Токены компонентов для темы: по каждому токену — первый найденный
 * в последовательности режимов [режим, предки по `extends`, режим по умолчанию],
 * внутри режима — по цепочке тем [тема, предки по каталогу].
 */
function applyComponentTokens(set: ThemeTokenSet, theme: ResolvedTheme, modeNames: readonly string[], components: readonly ComponentNode[]): void {
  const chain = theme.chain
  for (const component of components) {
    const tokens = component.themeTokens
    if (!chain.some(id => tokens[id] !== undefined))
      continue
    const componentKey = `${component.providerId}:${component.name}`
    const rootNames = new Set(chain.flatMap(id => Object.keys(tokens[id]?.root ?? {})))
    for (const token of rootNames) {
      const id = chain.find(themeId => tokens[themeId]?.root?.[token] !== undefined)!
      push(set.root, 'root', token, { source: 'component', value: tokens[id]!.root![token]!, theme: id, mode: 'root', componentKey })
    }
    const modeTokenNames = new Set(chain.flatMap(id => Object.values(tokens[id]?.modes ?? {}).flatMap(values => Object.keys(values))))
    for (const mode of modeNames) {
      const target = ensure(set.modes, mode, () => new Map())
      const pairs = componentModeSequence(theme.data, mode).flatMap(from => chain.map(id => ({ id, from })))
      for (const token of modeTokenNames) {
        const hit = pairs.find(({ id, from }) => tokens[id]?.modes[from]?.[token] !== undefined)
        if (hit)
          push(target, mode, token, { source: 'component', value: tokens[hit.id]!.modes[hit.from]![token]!, theme: hit.id, mode: hit.from, componentKey })
      }
    }
  }
}

/**
 * Фолбэки режима — по его цепочке `extends`, предки первыми. Токен, взятый из
 * режима по умолчанию, приходит с фолбэками режима по умолчанию — первыми, чтобы
 * свои фолбэки режима их перекрывали: иначе браузер без фичи остался бы со
 * значением, которого не понимает. Токен, чьё значение в паре дал компонент,
 * фолбэков темы не получает: фолбэк написан к значению темы.
 */
function applyFallbacks(set: ThemeTokenSet, theme: ResolvedTheme, modeNames: readonly string[]): void {
  const source = theme.providerId === APP_THEME_SOURCE ? 'app-theme' : 'theme'
  const defaultChain = modeChain(theme.data, theme.data.defaultMode ?? DEFAULT_MODE).names
  for (const mode of modeNames) {
    const chain = modeChain(theme.data, mode).names
    const scope = set.modes.get(mode)
    const effective = (token: string): TokenLayerValue | undefined => scope?.get(token)?.layers.findLast(value => !value.skipped)
    const fromDefault = (token: string): boolean => {
      const layer = effective(token)
      return layer !== undefined && layer.source !== 'component' && !chain.includes(layer.mode!)
    }
    const sources = [
      ...[...defaultChain].reverse().filter(name => !chain.includes(name)).map(name => ({ name, takes: fromDefault })),
      ...[...chain].reverse().map(name => ({ name, takes: (token: string) => effective(token)?.source !== 'component' })),
    ]
    const blocks: FallbackBlock[] = []
    for (const { name, takes } of sources) {
      for (const fallback of theme.data.modes[name]?.fallbacks ?? []) {
        const tokens = new Map<string, TokenChain>()
        for (const [token, value] of Object.entries(fallback.tokens)) {
          if (takes(token))
            push(tokens, mode, token, { source, value, theme: theme.id, mode: name })
        }
        if (tokens.size > 0)
          blocks.push({ supports: fallback.supports, tokens })
      }
    }
    if (blocks.length > 0)
      set.fallbacks.set(mode, blocks)
  }
}

/** Значение пары по данным темы: своё по цепочке режима, иначе из режима по умолчанию (T-10). */
function pairValues(theme: ResolvedTheme, mode: string): Map<string, { value: string, mode: string, fromDefault: boolean }> {
  const out = new Map<string, { value: string, mode: string, fromDefault: boolean }>()
  for (const [token, found] of modeValues(theme, theme.data.defaultMode ?? DEFAULT_MODE))
    out.set(token, { ...found, fromDefault: true })
  for (const [token, found] of modeValues(theme, mode))
    out.set(token, { ...found, fromDefault: false })
  return out
}

/**
 * Собственные отличия темы-объекта от родителя — слоем приложения (A-22, T-7):
 * значение, которого у родителя по этой паре нет или у него другое. Унаследованное
 * уже лежит слоем данных родителя. Значение из режима по умолчанию — запасное:
 * значение компонента им не перекрывается (T-10).
 */
function applyOwnDifferences(set: ThemeTokenSet, theme: ResolvedTheme, parent: ResolvedTheme, modeNames: readonly string[]): void {
  for (const [token, value] of Object.entries(theme.data.root)) {
    if (parent.data.root[token] !== value)
      push(set.root, 'root', token, { source: 'app-theme', value, theme: theme.id, mode: 'root' })
  }
  for (const mode of modeNames) {
    const target = ensure(set.modes, mode, () => new Map<string, TokenChain>())
    const inherited = pairValues(parent, mode)
    for (const [token, found] of pairValues(theme, mode)) {
      if (found.fromDefault && target.get(token)?.layers.some(layer => layer.source === 'component') === true)
        continue
      if (inherited.get(token)?.value !== found.value)
        push(target, mode, token, { source: 'app-theme', value: found.value, theme: theme.id, mode: found.mode })
    }
  }
}

/** Значения темы во всех её режимах — без режимов `define` и правок записи: то, что тема даёт сама. */
export function collectThemeTokens(theme: ResolvedTheme, components: readonly ComponentNode[]): ThemeTokenSet {
  const set: ThemeTokenSet = { themeId: theme.id, root: new Map(), modes: new Map(), fallbacks: new Map() }
  const modeNames = Object.keys(theme.data.modes)
  // Тема-объект приложения — слой после токенов компонентов: приложение
  // вправе перекрасить компонент провайдера своими данными. Унаследованное от
  // родителя — его данными, до компонентов: наследник без отличий выглядит как родитель.
  if (theme.providerId === APP_THEME_SOURCE && theme.inherited !== undefined) {
    const parent: ResolvedTheme = { ...theme, id: theme.inherited.id, data: theme.inherited.data }
    applyThemeData(set, parent, modeNames, 'theme')
    applyComponentTokens(set, theme, modeNames, components)
    applyOwnDifferences(set, theme, parent, modeNames)
  }
  else if (theme.providerId === APP_THEME_SOURCE) {
    applyComponentTokens(set, theme, modeNames, components)
    applyThemeData(set, theme, modeNames, 'app-theme')
  }
  else {
    applyThemeData(set, theme, modeNames, 'theme')
    applyComponentTokens(set, theme, modeNames, components)
  }
  applyFallbacks(set, theme, modeNames)
  return set
}

function copyChains(from: ReadonlyMap<string, TokenChain>, scope: string): Map<string, TokenChain> {
  const out = new Map<string, TokenChain>()
  for (const [token, chain] of from) {
    out.set(token, { token, scope, layers: [...chain.layers], ...(chain.effective !== undefined ? { effective: chain.effective } : {}) })
  }
  return out
}

/** Оставляет режимы набора в его порядке. */
function selectModes(set: ThemeTokenSet, modes: readonly ResolvedMode[]): ThemeTokenSet {
  const ordered = new Map<string, Map<string, TokenChain>>()
  const fallbacks = new Map<string, readonly FallbackBlock[]>()
  for (const mode of modes) {
    ordered.set(mode.name, set.modes.get(mode.name) ?? new Map())
    const blocks = set.fallbacks.get(mode.name)
    if (blocks)
      fallbacks.set(mode.name, blocks)
  }
  return { themeId: set.themeId, root: set.root, modes: ordered, fallbacks }
}

/**
 * Значения одной темы сборки: данные, компоненты, тема-объект, затем `define`
 * и `tokenOverrides` её записи — каждая тема со своими.
 */
function collectBuildTheme(entry: ResolvedBuildTheme, components: readonly ComponentNode[], options: CollectTokenLayersOptions): ThemeTokenSet {
  const set = collectThemeTokens(entry.theme, components)
  const { define, tokenOverrides, strictTokens } = entry.input

  // Известное для `strictTokens` — данные темы и токены компонентов, до режимов
  // `define`: токен, который задаёт только режим приложения, известным не считается.
  const known = new Set(set.root.keys())
  for (const tokens of set.modes.values()) {
    for (const token of tokens.keys())
      known.add(token)
  }

  for (const mode of entry.definitions) {
    const base = set.modes.get(mode.extends!) ?? new Map()
    const target = copyChains(base, mode.name)
    const definition = define?.[mode.name]
    for (const [token, value] of Object.entries(definition?.tokens ?? {}))
      push(target, mode.name, token, { source: 'app-mode', value, mode: mode.name })
    set.modes.set(mode.name, target)
    const own = (definition?.fallbacks ?? []).map((fallback) => {
      const tokens = new Map<string, TokenChain>()
      for (const [token, value] of Object.entries(fallback.tokens))
        push(tokens, mode.name, token, { source: 'app-mode', value, mode: mode.name })
      return { supports: fallback.supports, tokens }
    })
    const blocks = [...set.fallbacks.get(mode.extends!) ?? [], ...own]
    if (blocks.length > 0)
      set.fallbacks.set(mode.name, blocks)
  }

  for (const [scope, tokens] of Object.entries(tokenOverrides ?? {})) {
    const target = scope === 'root' ? set.root : set.modes.get(scope)
    if (!target)
      continue
    for (const [token, value] of Object.entries(tokens)) {
      const dropped = strictTokens === true && !known.has(token)
      push(target, scope, token, dropped ? { source: 'app-override', value, mode: scope, skipped: 'strict-tokens' } : { source: 'app-override', value, mode: scope })
      if (dropped)
        options.onSkippedOverride?.(entry.theme.id, scope, token)
    }
  }

  return selectModes(set, entry.modes)
}

export function collectTokenLayers(
  themes: ResolvedThemes,
  components: readonly ComponentNode[],
  options: CollectTokenLayersOptions = {},
): ResolvedTokens {
  const sets = themes.themes.map(entry => collectBuildTheme(entry, components, options))
  const index = themes.themes.findIndex(entry => entry.isDefault)
  return { default: index < 0 ? undefined : sets[index], themes: sets }
}

/** Значение токена в режиме темы: режимное, иначе режимонезависимое. */
export function tokenValueIn(set: ThemeTokenSet | undefined, mode: string, token: string): string | undefined {
  return set?.modes.get(mode)?.get(token)?.effective ?? set?.root.get(token)?.effective
}

/** Все цепочки темы: корень, режимы, фолбэки — для отчётов и обрезки. */
export function* allTokenChains(set: ThemeTokenSet | undefined): Generator<TokenChain> {
  if (!set)
    return
  yield* set.root.values()
  for (const tokens of set.modes.values())
    yield* tokens.values()
  for (const blocks of set.fallbacks.values()) {
    for (const block of blocks)
      yield* block.tokens.values()
  }
}

/** Слой значения для человека: `theme ink/dark`, `component @p:XhButton (paper/light)`, `app-override`. */
export function describeLayer(layer: TokenLayerValue): string {
  const from = [layer.theme, layer.mode].filter(Boolean).join('/')
  switch (layer.source) {
    case 'theme':
      return `theme ${from}`
    case 'component':
      return `component ${layer.componentKey} (${from})`
    case 'app-theme':
      return `app theme ${from}`
    case 'app-mode':
      return `app mode ${layer.mode}`
    case 'app-override':
      return `app override${layer.skipped ? ' (dropped by strictTokens)' : ''}`
  }
}
