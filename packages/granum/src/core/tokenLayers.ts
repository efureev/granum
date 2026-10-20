/**
 * Единственный источник правды о значениях токенов: какие
 * слои писали каждый токен в каждом режиме, в каком порядке и что уедет в
 * CSS (T-7). Из него сериализуется CSS и считаются отчёты, `granum tokens` и
 * обрезка — расходиться им негде.
 */
import type { ComponentNode } from './providerNode'
import type { GranumModesInput, ResolvedMode, ResolvedTheme, ResolvedThemes } from './resolveThemes'
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
   * умолчанию (T-10) или `root` — режимонезависимое.
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
  readonly active: ThemeTokenSet | undefined
  readonly previews: readonly ThemeTokenSet[]
}

export interface CollectTokenLayersOptions {
  readonly tokenOverrides?: GranumModesInput['tokenOverrides']
  readonly define?: GranumModesInput['define']
  readonly strictTokens?: boolean
  readonly onSkippedOverride?: (scope: string, token: string) => void
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
 * из режима по умолчанию (T-10). Недостающее — запасной вариант: значение,
 * которое режиму уже дал другой слой (токены компонента под темой-объектом
 * приложения), им не перекрывается.
 *
 * Возвращает по режиму токены, взятые из режима по умолчанию: с ними к режиму
 * приходят и фолбэки режима по умолчанию.
 */
function applyThemeData(set: ThemeTokenSet, theme: ResolvedTheme, modeNames: readonly string[], source: 'theme' | 'app-theme'): Map<string, Set<string>> {
  for (const [token, value] of Object.entries(theme.data.root))
    push(set.root, 'root', token, { source, value, theme: theme.id, mode: 'root' })
  const defaults = modeValues(theme, theme.data.defaultMode ?? DEFAULT_MODE)
  const fromDefault = new Map<string, Set<string>>()
  for (const mode of modeNames) {
    const target = ensure(set.modes, mode, () => new Map())
    const own = modeValues(theme, mode)
    const taken = new Set<string>()
    for (const [token, found] of defaults) {
      if (!own.has(token) && !target.has(token)) {
        push(target, mode, token, { source, value: found.value, theme: theme.id, mode: found.mode })
        taken.add(token)
      }
    }
    fromDefault.set(mode, taken)
    for (const [token, found] of own)
      push(target, mode, token, { source, value: found.value, theme: theme.id, mode: found.mode })
  }
  return fromDefault
}

/**
 * Токены компонентов для темы (A-24): по каждому токену — первый найденный
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
 * значением, которого не понимает.
 */
function applyFallbacks(set: ThemeTokenSet, theme: ResolvedTheme, modeNames: readonly string[], fromDefault: ReadonlyMap<string, ReadonlySet<string>>): void {
  const source = theme.providerId === APP_THEME_SOURCE ? 'app-theme' : 'theme'
  const defaultChain = modeChain(theme.data, theme.data.defaultMode ?? DEFAULT_MODE).names
  for (const mode of modeNames) {
    const chain = modeChain(theme.data, mode).names
    const taken = fromDefault.get(mode)
    const sources = [
      ...[...defaultChain].reverse().filter(name => !chain.includes(name)).map(name => ({ name, takes: (token: string) => taken?.has(token) === true })),
      ...[...chain].reverse().map(name => ({ name, takes: () => true })),
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

/** Значения темы без режимов `define` и override: данные, компоненты, тема-объект приложения. */
function collectThemeTokens(theme: ResolvedTheme, components: readonly ComponentNode[]): ThemeTokenSet {
  const set: ThemeTokenSet = { themeId: theme.id, root: new Map(), modes: new Map(), fallbacks: new Map() }
  const modeNames = Object.keys(theme.data.modes)
  // Тема-объект приложения — слой после токенов компонентов (A-27): приложение
  // вправе перекрасить компонент провайдера своими данными.
  let fromDefault: Map<string, Set<string>>
  if (theme.providerId === APP_THEME_SOURCE) {
    applyComponentTokens(set, theme, modeNames, components)
    fromDefault = applyThemeData(set, theme, modeNames, 'app-theme')
  }
  else {
    fromDefault = applyThemeData(set, theme, modeNames, 'theme')
    applyComponentTokens(set, theme, modeNames, components)
  }
  applyFallbacks(set, theme, modeNames, fromDefault)
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

export function collectTokenLayers(
  themes: ResolvedThemes,
  components: readonly ComponentNode[],
  options: CollectTokenLayersOptions = {},
): ResolvedTokens {
  const previews = themes.previews.map(preview => selectModes(collectThemeTokens(preview.theme, components), preview.modes))
  if (!themes.theme)
    return { active: undefined, previews }

  const set = collectThemeTokens(themes.theme, components)

  // Известное для `strictTokens` — данные темы и токены компонентов, до режимов
  // `define`: токен, который задаёт только режим приложения, известным не считается.
  const known = new Set(set.root.keys())
  for (const tokens of set.modes.values()) {
    for (const token of tokens.keys())
      known.add(token)
  }

  for (const mode of themes.definitions) {
    const base = set.modes.get(mode.extends!) ?? new Map()
    const target = copyChains(base, mode.name)
    const definition = options.define?.[mode.name]
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

  for (const [scope, tokens] of Object.entries(options.tokenOverrides ?? {})) {
    const target = scope === 'root' ? set.root : set.modes.get(scope)
    if (!target)
      continue
    for (const [token, value] of Object.entries(tokens)) {
      const dropped = options.strictTokens === true && !known.has(token)
      push(target, scope, token, dropped ? { source: 'app-override', value, mode: scope, skipped: 'strict-tokens' } : { source: 'app-override', value, mode: scope })
      if (dropped)
        options.onSkippedOverride?.(scope, token)
    }
  }

  return { active: selectModes(set, themes.modes), previews }
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
