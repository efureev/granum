/**
 * Копия темы (D-13): независимый исходник (C-42) со значениями источника,
 * раскрытыми один раз. Наследование темы и значения компонентов по темам (A-24)
 * раскрываются; наследование режимов остаётся — это связь внутри темы.
 */
import type { GranumConfig } from '../config'
import type { GranumModeData, GranumThemeComponentValues, GranumThemeData } from '../contract'
import type { GranumAppTheme, ResolvedTheme } from '../core/resolveThemes'
import type { TokenChain, TokenLayerValue } from '../core/tokenLayers'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import process from 'node:process'
import { ThemeResolutionError, ThemeSourceError } from '../core/errors'
import { splitThemeKey } from '../core/resolveThemes'
import { checkThemeData, DEFAULT_MODE, isThemeId, modeChain, unflattenThemeComponents } from '../core/themeData'
import { collectThemeTokens } from '../core/tokenLayers'
import { loadThemeSource } from './themeSource'
import { resolveThemeOnly } from './themeStylesheet'

export interface CopyThemeOptions {
  /** Id темы графа конфига (`id`, `providerId:id`) или путь к исходнику темы. */
  readonly source: string
  /** Файлы исходника-папки, которые не данные темы (C-42). */
  readonly ignore?: readonly string[]
  /** Папка новой темы; должна не существовать или быть пустой. */
  readonly dest: string
  readonly id: string
  readonly title?: string
  /** Версия копии; по умолчанию `0.1.0`. */
  readonly version?: string
  /** Конфиг приложения: граф для id темы и для исходника с `extends`. */
  readonly config?: GranumConfig
  /** Корень приложения: от него разрешаются провайдеры и относительные пути. */
  readonly root?: string
}

export interface CopyThemeResult {
  readonly dir: string
  /** Записанные файлы относительно папки, отсортированы. */
  readonly files: readonly string[]
  readonly data: GranumThemeData
}

type Sections = Record<string, Record<string, { root: Record<string, string>, modes: Record<string, Record<string, string>> }>>

function section(sections: Sections, componentKey: string): Sections[string][string] {
  const at = componentKey.lastIndexOf(':')
  const byComponent = sections[componentKey.slice(0, at)] ??= {}
  return byComponent[componentKey.slice(at + 1)] ??= { root: {}, modes: {} }
}

/** Действующий слой значения: последний непропущенный. */
function effective(chain: TokenChain | undefined): TokenLayerValue | undefined {
  return chain?.layers.findLast(layer => !layer.skipped)
}

/**
 * Где в разделе лежат значения токена так, чтобы каждая пара копии дала то же,
 * что пара источника: одно значение на все пары — в `root` раздела, иначе по
 * режимам. Значение режима, которое режим и так получит по цепочке `extends` или
 * из режима по умолчанию (T-10), не пишется: структура источника сохраняется.
 */
function placeByPairs(data: GranumThemeData, rootValue: string | undefined, pairs: ReadonlyMap<string, string | undefined>): { root?: string, modes: Map<string, string> } {
  const values = [...pairs.values()]
  if (rootValue !== undefined && values.every(value => value === rootValue))
    return { modes: new Map(), root: rootValue }
  const defaultChain = modeChain(data, data.defaultMode ?? DEFAULT_MODE).names
  const written = new Map([...pairs].filter((entry): entry is [string, string] => entry[1] !== undefined))
  const lookup = (names: readonly string[]): string | undefined => names.map(name => written.get(name)).find(value => value !== undefined)
  const evaluate = (): string[] => [...pairs.keys()].map(mode => lookup(modeChain(data, mode).names) ?? lookup(defaultChain) ?? '')
  const expected = evaluate().join('\u0000')
  // Сначала снимаются потомки — значения остаются у предков и режима по умолчанию.
  const order = [...written.keys()].sort((a, b) => Number(defaultChain.includes(a)) - Number(defaultChain.includes(b)) || modeChain(data, b).names.length - modeChain(data, a).names.length)
  for (const mode of order) {
    const value = written.get(mode)!
    written.delete(mode)
    if (evaluate().join('\u0000') !== expected)
      written.set(mode, value)
  }
  return { modes: written }
}

/**
 * Данные копии: структура источника, а токен, который в источнике хоть в одной
 * паре выигрывает значением компонента (A-24), переезжает в раздел этого
 * компонента со значениями всех пар — по парам то же, коллизий нет (INV-THEME-13).
 */
function materialize(theme: ResolvedTheme, components: Parameters<typeof collectThemeTokens>[1]): { root: Record<string, string>, modes: Record<string, GranumModeData>, sections: Sections } {
  const pure = unflattenThemeComponents(theme.data)
  const set = collectThemeTokens(theme, components)
  const modeNames = Object.keys(pure.modes)
  const owners = new Map<string, string>()
  const fromComponentEverywhere = new Map<string, boolean>()
  const claim = (chain: TokenChain): void => {
    const layer = effective(chain)
    const byComponent = layer?.source === 'component'
    fromComponentEverywhere.set(chain.token, (fromComponentEverywhere.get(chain.token) ?? true) && byComponent)
    if (byComponent && !owners.has(chain.token))
      owners.set(chain.token, layer!.componentKey!)
  }
  for (const chain of set.root.values())
    claim(chain)
  for (const scope of set.modes.values()) {
    for (const chain of scope.values())
      claim(chain)
  }

  const owned = (token: string): boolean => owners.has(token)
  const sections: Sections = {}
  for (const [providerId, byComponent] of Object.entries(pure.components ?? {})) {
    for (const [name, values] of Object.entries(byComponent)) {
      const target = section(sections, `${providerId}:${name}`)
      Object.assign(target.root, Object.fromEntries(Object.entries(values.root ?? {}).filter(([token]) => !owned(token))))
      for (const [mode, tokens] of Object.entries(values.modes ?? {}))
        Object.assign(target.modes[mode] ??= {}, Object.fromEntries(Object.entries(tokens).filter(([token]) => !owned(token))))
    }
  }
  const root = Object.fromEntries(Object.entries(pure.root).filter(([token]) => !owned(token)))
  const modes: Record<string, GranumModeData> = {}
  for (const [name, mode] of Object.entries(pure.modes)) {
    // Фолбэк темы к токену, который во всех парах дал компонент, в источнике не действовал.
    const fallbacks = mode.fallbacks
      ?.map(block => ({ ...block, tokens: Object.fromEntries(Object.entries(block.tokens).filter(([token]) => !(owned(token) && fromComponentEverywhere.get(token)))) }))
      .filter(block => Object.keys(block.tokens).length > 0)
    const { fallbacks: _fallbacks, ...entry } = mode
    modes[name] = {
      ...entry,
      ...(fallbacks !== undefined && fallbacks.length > 0 ? { fallbacks } : {}),
      tokens: Object.fromEntries(Object.entries(mode.tokens).filter(([token]) => !owned(token))),
    }
  }

  for (const [token, owner] of owners) {
    const rootValue = effective(set.root.get(token))?.value
    const pairs = new Map(modeNames.map(mode => [mode, effective(set.modes.get(mode)?.get(token))?.value ?? rootValue]))
    const placed = placeByPairs(pure, rootValue, pairs)
    const target = section(sections, owner)
    if (placed.root !== undefined)
      target.root[token] = placed.root
    for (const [mode, value] of placed.modes)
      (target.modes[mode] ??= {})[token] = value
  }
  return { root, modes, sections }
}

function compactSections(sections: Sections): GranumThemeData['components'] {
  const out: Record<string, Record<string, GranumThemeComponentValues>> = {}
  for (const [providerId, byComponent] of Object.entries(sections)) {
    for (const [name, values] of Object.entries(byComponent)) {
      const modes = Object.fromEntries(Object.entries(values.modes).filter(([, tokens]) => Object.keys(tokens).length > 0))
      if (Object.keys(values.root).length === 0 && Object.keys(modes).length === 0)
        continue
      const target = out[providerId] ??= {}
      target[name] = {
        ...(Object.keys(values.root).length > 0 ? { root: values.root } : {}),
        ...(Object.keys(modes).length > 0 ? { modes } : {}),
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function sortKeys<T>(value: T): T {
  if (Array.isArray(value))
    return value.map(sortKeys) as T
  if (typeof value !== 'object' || value === null)
    return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys((value as Record<string, unknown>)[key])])) as T
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function isSourceDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory() && existsSync(join(path, 'theme.json'))
}

/** Источник: данные темы и её значения по парам, с раскрытым наследованием. */
function resolveSource(options: CopyThemeOptions): { theme: ResolvedTheme, components: Parameters<typeof collectThemeTokens>[1], versions: ReadonlyMap<string, string> } | { data: GranumThemeData } {
  const root = options.root ?? process.cwd()
  const path = resolvePath(root, options.source)
  let choice: string | GranumAppTheme = options.source
  if (isSourceDir(path)) {
    const loaded = loadThemeSource(path, { ignore: options.ignore ?? [] })
    if (loaded.extends === undefined && options.config === undefined) {
      const { sources: _sources, ...data } = loaded
      return { data }
    }
    choice = loaded
  }
  else if (!isThemeId(splitThemeKey(options.source).id)) {
    throw new ThemeSourceError('theme-json-missing', path, `'${options.source}' is neither a theme source folder nor a theme id`)
  }
  if (options.config === undefined) {
    throw new ThemeResolutionError('theme-missing', typeof choice === 'string'
      ? `copying theme '${choice}' needs the application config: the theme and its parents come from the provider graph`
      : `the source of theme '${choice.id}' extends '${String(choice.extends)}': copying it needs the application config to resolve the parent`)
  }
  const resolution = resolveThemeOnly({
    providers: options.config.providers,
    themes: [{ theme: choice, default: true, modes: [] }],
    ...(options.config.activation !== undefined ? { activation: options.config.activation } : {}),
    root,
  })
  const versions = new Map(resolution.providers.flatMap(provider => (provider.version !== undefined ? [[provider.id, provider.version] as const] : [])))
  return { theme: resolution.themes.default!.theme, components: resolution.selection.entries.map(entry => entry.component), versions }
}

/** Копия темы (D-13): исходник независимой темы на диске. */
export function copyTheme(options: CopyThemeOptions): CopyThemeResult {
  if (!isThemeId(options.id))
    throw new ThemeSourceError('theme-data-invalid', options.dest, `the id of the copy must be a slug /^[a-z][a-z0-9-]*$/, got '${options.id}'`)
  const dir = resolvePath(options.root ?? process.cwd(), options.dest)
  if (existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).length > 0))
    throw new ThemeSourceError('unexpected-entry', dir, 'the destination of a copy must not exist or be empty')

  const source = resolveSource(options)
  const base: GranumThemeData = 'data' in source ? source.data : source.theme.data
  const { root, modes, sections } = 'data' in source
    ? { root: base.root, modes: base.modes, sections: {} as Sections }
    : materialize(source.theme, source.components)
  const components = 'data' in source ? base.components : compactSections(sections)
  const targets: Record<string, string> = { ...base.targets }
  if (!('data' in source)) {
    // Пакет без версии (объектная форма) — `*`: раздел без цели копия не пройдёт (C-41).
    for (const providerId of Object.keys(components ?? {})) {
      if (!Object.hasOwn(targets, providerId)) {
        const version = source.versions.get(providerId)
        targets[providerId] = version !== undefined ? `^${version.replace(/\+.*$/, '')}` : '*'
      }
    }
  }

  const data: GranumThemeData = {
    id: options.id,
    title: options.title ?? base.title,
    ...(base.description !== undefined ? { description: base.description } : {}),
    version: options.version ?? '0.1.0',
    ...(Object.keys(targets).length > 0 ? { targets } : {}),
    root,
    modes,
    ...(base.defaultMode !== undefined ? { defaultMode: base.defaultMode } : {}),
    ...(base.baseCss !== undefined ? { baseCss: base.baseCss } : {}),
    ...(base.extensions !== undefined ? { extensions: base.extensions } : {}),
    ...(components !== undefined ? { components } : {}),
  }
  const issue = checkThemeData(data)
  if (issue)
    throw new ThemeSourceError('theme-data-invalid', issue.path ? `${dir} (${issue.path})` : dir, issue.details, { dataReason: issue.reason })

  const files = new Map<string, string>()
  const modeOrder = Object.keys(data.modes)
  const themeJson = {
    id: data.id,
    title: data.title,
    ...(data.description !== undefined ? { description: data.description } : {}),
    version: data.version,
    ...(data.targets !== undefined ? { targets: sortKeys(data.targets) } : {}),
    ...(data.defaultMode !== undefined ? { defaultMode: data.defaultMode } : {}),
    // Порядок режимов — порядок ключей: его не сортируем.
    modes: Object.fromEntries(modeOrder.map((name) => {
      const { tokens: _tokens, ...entry } = data.modes[name]!
      return [name, sortKeys(entry)]
    })),
    ...(data.extensions !== undefined ? { extensions: sortKeys(data.extensions) } : {}),
  }
  files.set('theme.json', json(themeJson))
  if (Object.keys(data.root).length > 0)
    files.set('root.json', json(sortKeys(data.root)))
  if (data.baseCss !== undefined && data.baseCss.length > 0) {
    const css = data.baseCss.join('\n')
    files.set('base.css', css.endsWith('\n') ? css : `${css}\n`)
  }
  for (const name of modeOrder) {
    const tokens = data.modes[name]!.tokens
    if (Object.keys(tokens).length > 0)
      files.set(`modes/${name}.json`, json(sortKeys(tokens)))
  }
  for (const [providerId, byComponent] of Object.entries(data.components ?? {})) {
    for (const [name, values] of Object.entries(byComponent)) {
      if (values.root !== undefined)
        files.set(`components/${providerId}/${name}/root.json`, json(sortKeys(values.root)))
      for (const [mode, tokens] of Object.entries(values.modes ?? {}))
        files.set(`components/${providerId}/${name}/modes/${mode}.json`, json(sortKeys(tokens)))
    }
  }
  for (const file of files.keys()) {
    if (!resolvePath(dir, file).startsWith(`${dir}${sep}`))
      throw new ThemeSourceError('theme-data-invalid', join(dir, file), 'a copy writes only inside its folder')
  }
  for (const [file, content] of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), content)
  }
  return { dir, files: [...files.keys()].sort(), data }
}
