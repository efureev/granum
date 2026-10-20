/**
 * `granum doctor`: полный отчёт о конфигурации приложения по манифестам,
 * без сборки. Уровни: `error` — обязано сломать сборку (файла нет, директива
 * не раскрыта, граница нарушена); `warn` — законно, но подозрительно; падает
 * только под `--strict`.
 */
import type { ModesSource, ResolvedThemeWarning, ThemeSource } from '../../core/resolveThemes'
import type { ProviderClassSource } from '../dialects'
import type { PreparedApp } from '../prepare'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isLoadedManifest } from '../../contract/manifest'
import { sortedUnique } from '../../core/dedupe'
import { DEFAULT_MODE, modeChain } from '../../core/themeData'
import { allTokenChains, describeLayer } from '../../core/tokenLayers'
import { stripCssComments } from '../../engine/extract'
import { scanCssBlocks } from '../cssDeclarations'
import { boundaryKindOf, collectImportSpecifiers } from '../imports'
import { resolveInlinedCssSources, resolveProviderPath } from '../inlinedCss'
import { packageSubcomponents } from '../subcomponents'
import { findFallbackOnlyTokens, findUndefinedTokens } from '../undefinedTokens'

export interface DoctorProviderInfo {
  readonly id: string
  readonly form: 'manifest' | 'object'
  readonly version?: string
  readonly components: number
  readonly hasTheme: boolean
  readonly hasEngine: boolean
  /** Словарь артефакта; `null` — пакет ни от какого словаря не зависит. */
  readonly dialect: string | null
  /** Отпечаток словаря артефакта: по нему принято решение о доверии списку классов. */
  readonly vocabulary: string | null
  /** Реализация, собравшая пакет. */
  readonly engineName: string | null
  /** Откуда взят список классов: из манифеста или пересчитан движком приложения. */
  readonly classSource: ProviderClassSource
  readonly rulesLoaded: boolean
}

export interface DoctorComponentInfo {
  readonly key: string
  readonly providerId: string
  readonly name: string
  readonly dependencies: readonly string[]
  readonly classes: number
  readonly safelist: number
  readonly css: number
  readonly group?: string
}

/** At-правила, которые сами ничего на странице не красят: шрифты, свойства, анимации. */
const INERT_AT_RULES = new Set(['@font-face', '@property', '@keyframes', '@counter-style', '@font-feature-values', '@font-palette-values'])

/** Правила `baseCss` верхнего уровня, которые красят страницу: селекторы и at-правила с ними. */
function globalBaseRules(css: string): string[] {
  const preludes = scanCssBlocks(stripCssComments(css, 'space')).blocks.map(block => block.prelude.trim().replace(/\s+/g, ' '))
  return preludes.filter(prelude => !INERT_AT_RULES.has(prelude.split(/[\s(]/, 1)[0]!.toLowerCase().replace(/^@-[a-z]+-/, '@')))
}

/** Область конфликта для человека: у дополнительной темы — с её именем, `root` — режимонезависимые токены. */
function conflictScope(scope: string): string {
  const at = scope.indexOf('/')
  const mode = at >= 0 ? scope.slice(at + 1) : scope
  const where = mode === 'root' ? 'the mode-independent tokens' : `mode '${mode}'`
  return at >= 0 ? `${where} of theme '${scope.slice(0, at)}'` : where
}

export interface DoctorTokenConflict {
  /** Режим или `root`; у дополнительной темы — `<тема>/<режим>` и `<тема>/root`. */
  readonly mode: string
  readonly token: string
  readonly sources: readonly string[]
  readonly finalValue: string
}

export type DoctorDiagnosticCode
  = | 'missing-file'
    | 'apply-not-expanded'
    | 'boundary'
    | 'component-theme-unknown'
    | 'component-mode-missing'
    | 'theme-mode-missing'
    | 'mode-extends-unresolved'
    | 'mode-extends-cycle'
    | 'token-conflict'
    | 'theme-base-global'
    | 'token-undefined'
    | 'token-fallback-only'
    | 'safelist-redundant'
    | 'safelist-dead'
    | 'css-double-delivery'
    | 'peer-missing'
    | 'important-in-provider-css'
    | 'override-skipped'
    | 'provider-without-manifest'
    | 'provider-scanned'
    | 'unused-provider'
    | 'provider-dialect-mismatch'
    | 'provider-classes-recovered'
    | 'provider-classes-dropped'
    | 'engine-rules-skipped'
    | 'subcomponents-missing'

export interface DoctorDiagnostic {
  readonly level: 'error' | 'warn'
  readonly code: DoctorDiagnosticCode
  readonly subject: string
  readonly message: string
  /**
   * Перечисление, которое относится к находке: классы safelist, потерянные
   * имена, файлы. Отдельным полем, а не внутри `message`, потому что текстовый
   * вывод сворачивает его в счётчик и разворачивает по `--code=`.
   */
  readonly items?: readonly string[]
}

export interface DoctorThemeInfo {
  readonly id: string
  readonly default: boolean
  readonly modes: readonly { readonly name: string, readonly value: string, readonly colorScheme: 'light' | 'dark', readonly origin: 'theme' | 'define', readonly tokens: number }[]
  readonly modesSource: ModesSource
}

export interface DoctorReport {
  /** Движок приложения: реализация, словарь и его отпечаток. */
  readonly engine: {
    readonly name: string
    readonly version?: string
    readonly dialect: string
    readonly vocabulary: string
  }
  readonly providers: readonly DoctorProviderInfo[]
  readonly components: readonly DoctorComponentInfo[]
  /** Темы сборки и их режимы: что собрано и откуда. */
  readonly themes: {
    /** Основная тема. */
    readonly defaultTheme: string | null
    readonly themeSource: ThemeSource | null
    readonly owner: string | null
    readonly themes: readonly DoctorThemeInfo[]
    readonly warnings: readonly ResolvedThemeWarning[]
  }
  readonly tokenConflicts: readonly DoctorTokenConflict[]
  /** Потребляется выбранным компонентом, но не объявлен ни одним слоем. */
  readonly undefinedTokens: readonly { readonly token: string, readonly component: string }[]
  readonly files: { readonly checked: number, readonly missing: readonly string[] }
  readonly diagnostics: readonly DoctorDiagnostic[]
  /** Нет `error`. */
  readonly ok: boolean
  /** Нет ни одной диагностики — это проверяет `--strict`. */
  readonly clean: boolean
}

function themeWarningSubject(w: ResolvedThemeWarning): string {
  switch (w.kind) {
    case 'component-theme-unknown': return `${w.providerId}:${w.component}`
    case 'mode-extends-unresolved': return `${w.theme}/${w.mode}`
    case 'mode-extends-cycle': return `${w.theme}/${w.chain.join(' → ')}`
  }
}

export function formatThemeWarning(w: ResolvedThemeWarning): string {
  switch (w.kind) {
    case 'component-theme-unknown':
      return `component ${w.providerId}:${w.component} ships tokens for theme "${w.theme}", which no catalog in the graph declares — they are not used`
    case 'mode-extends-unresolved':
      return `modes.define.${w.mode} of theme '${w.theme}' extends "${w.base}", which is neither a mode of that theme nor a defined mode — it inherits the default mode instead`
    case 'mode-extends-cycle':
      return `cycle in modes.define[].extends of theme '${w.theme}': ${w.chain.join(' → ')} — the chain is cut at the default mode`
  }
}

export async function granumDoctor(app: PreparedApp): Promise<DoctorReport> {
  const { resolution, engine } = app
  const diagnostics: DoctorDiagnostic[] = []
  const warn = (code: DoctorDiagnosticCode, subject: string, message: string, items?: readonly string[]): void => {
    diagnostics.push({ level: 'warn', code, subject, message, ...(items?.length ? { items } : {}) })
  }
  const error = (code: DoctorDiagnosticCode, subject: string, message: string, items?: readonly string[]): void => {
    diagnostics.push({ level: 'error', code, subject, message, ...(items?.length ? { items } : {}) })
  }

  const decisions = new Map(app.engineDecisions.map(d => [d.providerId, d]))
  const providers: DoctorProviderInfo[] = resolution.providers.map((p) => {
    const decision = decisions.get(p.id)
    return {
      id: p.id,
      form: p.form,
      ...(isLoadedManifest(p.source) ? { version: p.source.manifest.version } : {}),
      components: p.components.length,
      hasTheme: Object.keys(p.theme.catalog).length > 0 || p.theme.tokensCss !== undefined || p.theme.baseCss !== undefined,
      hasEngine: p.engine !== undefined || (p.engineArtifact?.module ?? null) !== null,
      dialect: decision?.dialect ?? p.engineArtifact?.dialect ?? null,
      vocabulary: decision?.vocabulary ?? p.engineArtifact?.vocabulary ?? null,
      engineName: decision?.engineName ?? p.engineArtifact?.name ?? null,
      classSource: decision?.classes ?? 'manifest',
      rulesLoaded: decision?.rulesLoaded ?? false,
    }
  })

  /*
   * Расхождение словарей. Совпавший диалект при разошедшихся отпечатках
   * сам по себе не предупреждение: так выглядит любое приложение с собственным
   * правилом в фабрике движка. Предупреждает только РАЗНИЦА наборов — класс,
   * которого приложение не знает (`dropped`), и класс, потерянный сборкой
   * пакета (`recovered`). Второй опаснее: без отпечатка он молчал бы.
   */
  for (const decision of app.engineDecisions) {
    if (decision.reason === 'dialect') {
      warn(
        'provider-dialect-mismatch',
        decision.providerId,
        `package was built by '${decision.engineName ?? 'unknown engine'}' for dialect '${decision.dialect}', the application engine speaks '${engine.dialect}' — `
        + `its classes were re-extracted by the application engine instead of trusted`,
      )
    }
    if (decision.rulesSkipped) {
      warn(
        'engine-rules-skipped',
        decision.providerId,
        `package ships engine rules for dialect '${decision.dialect}', which the application engine does not speak — the rules are not loaded, `
        + `and classes that relied on them will show up as unmatched`,
      )
    }
    if (decision.gained.length > 0) {
      warn(
        'provider-classes-recovered',
        decision.providerId,
        `${decision.gained.length} classes the application engine knows were missing from the manifest `
        + '— the package build dropped them, the application got them back',
        decision.gained,
      )
    }
    if (decision.lost.length > 0) {
      warn(
        'provider-classes-dropped',
        decision.providerId,
        `${decision.lost.length} classes from the manifest have no rule in the application engine `
        + '— they stay in the engine input and show up as unmatched',
        decision.lost,
      )
    }
  }

  const components: DoctorComponentInfo[] = resolution.selection.entries.map(({ provider, component }) => ({
    key: `${provider.id}:${component.name}`,
    providerId: provider.id,
    name: component.name,
    dependencies: component.dependencies.map(d => (typeof d === 'string' ? d : `${d.provider}:{${d.components.join(', ')}}`)),
    classes: component.classes.length,
    safelist: component.safelist.length,
    css: component.css.length,
    ...(component.group ? { group: component.group } : {}),
  }))

  // Конфликты — по тем же слоям, из которых эмитится CSS. Конфликт — два
  // пакетных слоя на один токен: значения приложения перекрывают пакет
  // намеренно. Режимы `define` — копии своей базы, их не считаем повторно.
  const tokenConflicts: DoctorTokenConflict[] = []
  for (const [i, entry] of resolution.themes.themes.entries()) {
    const set = resolution.tokens.themes[i]
    const theme = entry.theme
    const definedModes = new Set(entry.definitions.map(mode => mode.name))
    // У основной темы режим пишется как раньше, у дополнительной — с темой.
    const scopeOf = (mode: string): string => (entry.isDefault ? mode : `${theme.id}/${mode}`)
    for (const chain of allTokenChains(set)) {
      if (definedModes.has(chain.scope))
        continue
      const emitted = chain.layers.filter(l => l.skipped === undefined && (l.source === 'theme' || l.source === 'component'))
      if (emitted.length >= 2)
        tokenConflicts.push({ mode: scopeOf(chain.scope), token: chain.token, sources: chain.layers.filter(l => l.skipped === undefined).map(describeLayer), finalValue: chain.effective! })
    }

    // Литералы компонента в режиме сборки, взятые из режима по умолчанию: у
    // компонента нет файла ни этого режима, ни его предков по `extends`, и,
    // например, забытый `dark.json` молча даёт тёмному режиму светлые значения.
    // Формула с `var(` сама следует ролям режима — её не считаем. Режимы
    // `define` наследуют свою базу — их не считаем повторно.
    const defaultMode = theme.data.defaultMode ?? DEFAULT_MODE
    const fellBack = new Map<string, { mode: string, component: string, tokens: string[] }>()
    for (const mode of entry.modes) {
      if (definedModes.has(mode.name) || modeChain(theme.data, mode.name).names.includes(defaultMode))
        continue
      for (const chain of set?.modes.get(mode.name)?.values() ?? []) {
        const layer = chain.layers.find(l => l.source === 'component' && l.mode === defaultMode && l.componentKey !== undefined)
        if (!layer?.componentKey || layer.value.includes('var('))
          continue
        const found = fellBack.get(`${layer.componentKey} ${mode.name}`)
          ?? { mode: mode.name, component: layer.componentKey, tokens: [] }
        found.tokens.push(`--${chain.token}`)
        fellBack.set(`${layer.componentKey} ${mode.name}`, found)
      }
    }
    for (const { mode, component, tokens } of fellBack.values()) {
      warn('component-mode-missing', component, `no values for mode '${mode}' of theme '${theme.id}' in its themesDir — takes the literals of the default mode '${defaultMode}'; a value that is the same in every mode belongs in root.json`, tokens.sort())
    }

    // То же для данных самой темы: ни у режима, ни у его предков по `extends`
    // значения нет, и в CSS уходит литерал режима по умолчанию. Судится итог
    // токена: значение, которое режиму дал другой слой, находкой не считается.
    for (const mode of entry.modes) {
      if (definedModes.has(mode.name))
        continue
      const names = modeChain(theme.data, mode.name).names
      const tokens: string[] = []
      for (const chain of set?.modes.get(mode.name)?.values() ?? []) {
        const layer = chain.layers.findLast(l => l.skipped === undefined)
        if (layer && (layer.source === 'theme' || layer.source === 'app-theme') && layer.mode !== undefined && !names.includes(layer.mode) && !layer.value.includes('var('))
          tokens.push(`--${chain.token}`)
      }
      if (tokens.length > 0)
        warn('theme-mode-missing', `${theme.id}/${mode.name}`, `mode '${mode.name}' of theme '${theme.id}' has no value for these tokens along its extends chain — takes the literals of the default mode '${defaultMode}'; a value that is the same in every mode belongs in root`, tokens.sort())
    }
  }

  // Файлы: тема, компоненты, entry — существуют ли; заодно проверки содержимого.
  const missing: string[] = []
  let checked = 0
  const readIfExists = (path: string, subject: string): string | undefined => {
    checked++
    if (!existsSync(path)) {
      missing.push(path)
      error('missing-file', subject, `file is missing: ${path}`)
      return undefined
    }
    return readFileSync(path, 'utf8')
  }
  for (const source of resolveInlinedCssSources(resolution))
    readIfExists(source.path, `${source.providerId} (${source.kind})`)
  for (const { provider, component } of resolution.selection.entries) {
    const key = `${provider.id}:${component.name}`
    for (const path of component.css) {
      const css = readIfExists(resolveProviderPath(path, provider.baseUrl), key)
      if (css === undefined)
        continue
      if (/@apply\s/.test(stripCssComments(css)))
        error('apply-not-expanded', key, `${path} still contains @apply — rebuild the provider with granumProvider()`)
      if (/!\s*important/i.test(css))
        warn('important-in-provider-css', key, `${path} uses !important — inside cascade layers it inverts the layer order`)
    }
    if (provider.form === 'manifest' && isLoadedManifest(provider.source)) {
      const files = provider.source.manifest.components[component.name]?.files ?? []
      for (const file of files) {
        const code = readIfExists(resolveProviderPath(file, provider.baseUrl), key)
        if (code === undefined)
          continue
        for (const spec of collectImportSpecifiers(code)) {
          const kind = boundaryKindOf(spec)
          if (kind)
            error('boundary', key, `${file} imports '${spec}' (${kind}) — browser code of a provider must not reach node`)
        }
      }
    }
  }

  // Манифестные предупреждения провайдеров — доносятся до приложения,
  // но только про компоненты, которые действительно в сборке.
  const selectedKeys = new Set(resolution.selection.order)
  for (const provider of resolution.providers) {
    if (!isLoadedManifest(provider.source))
      continue
    for (const w of provider.source.manifest.warnings) {
      if (w.component && !selectedKeys.has(`${provider.id}:${w.component}`))
        continue
      const subject = w.component ? `${provider.id}:${w.component}` : provider.id
      if (w.code === 'safelist-redundant')
        warn('safelist-redundant', subject, 'safelist duplicates statically extracted classes', (w.classes as string[] | undefined) ?? [])
      else if (w.code === 'css-double-delivery')
        warn('css-double-delivery', subject, 'component CSS is both inlined by granum and imported by its chunk — it arrives twice', (w.files as string[] | undefined) ?? [])
      else if (w.code === 'peer-missing' && w.provider === '@feugene/granum')
        warn('peer-missing', provider.id, `imports '@feugene/granum' at runtime but does not list it in peerDependencies: only './contract' is embedded by the provider build`)
      else if (w.code === 'peer-missing')
        warn('peer-missing', provider.id, `depends on provider '${String(w.provider)}' but does not list it in peerDependencies`)
    }
  }

  /*
   * Токены: нужен компоненту извне, не даёт никто.
   *
   * «Нужен извне» — не то же, что «потребляется». Из потребления вычитаются три
   * вещи, и каждая — объявление компонента о себе, а не недосмотр:
   *
   *   - `var(--x, fallback)`: значение по умолчанию записано в самом `var()`,
   *     молча не покрасить нельзя. Такое потребление в `requiresTokens` не
   *     входит вовсе (`tokens.requires` манифеста);
   *   - `--x:` где-то в собственном CSS или инлайн-стиле компонента: значение
   *     даёт он сам, и слою granum его задавать незачем. Тоже вычтено на сборке;
   *   - `dynamicTokens`: имя собирается из переменной (`var(--gr-z-${'{'}name${'}'})`),
   *     и статический анализ видит только префикс. Обрезка это объявление
   *     уважает, доктор обязан уважать так же.
   *
   * До этого проверялся весь `consumes`, и на дизайн-системе из 84 компонентов
   * находок было 279 при одной настоящей: `--strict` от такого шума непригоден.
   */
  // Вердикт — той же функцией, что у отчёта сборки.
  const undefinedTokens = findUndefinedTokens(resolution)
  for (const { token, component: key } of undefinedTokens)
    warn('token-undefined', `${key}:${token}`, `token '${token}' is consumed by ${key} but no granum layer defines it for any active theme — it may still come from the application CSS or an engine rule`)

  // Запасное значение `var()` прячет токен, которого никто не задаёт: компонент
  // молча рисует его всегда. Хук объявляет, что так задумано.
  for (const { component: key, tokens } of findFallbackOnlyTokens(resolution))
    warn('token-fallback-only', key, 'reads these tokens only through var() fallbacks, and no granum layer defines them for the active theme — the component always renders the fallback; define them, or list intentional hooks in hookTokens', tokens)

  // Safelist без правила у движка — мёртвая запись.
  const safelistAll = sortedUnique(resolution.selection.entries.flatMap(e => e.component.safelist))
  if (safelistAll.length > 0) {
    const out = await engine.generate({ classes: new Set(safelistAll), ...app.engineContribution })
    for (const dead of out.unmatched) {
      const owners = resolution.selection.entries.filter(e => e.component.safelist.includes(dead)).map(e => `${e.provider.id}:${e.component.name}`)
      warn('safelist-dead', owners.join(', '), `safelist entry '${dead}' has no rule in the engine — it produces no CSS`)
    }
  }

  for (const w of resolution.themes.warnings)
    warn(w.kind, themeWarningSubject(w), formatThemeWarning(w))
  // `baseCss` дополнительной темы лежит в её листе, а лист, однажды загруженный,
  // остаётся в документе: правило стиля оттуда действует на всю страницу и после
  // возврата к основной теме и спорит с базой общего листа порядком листов.
  // Безвредны только at-правила, которые сами ничего не красят. Запись, которую
  // несёт общий лист (вся база основной темы), не судится: она общая по определению.
  const mainBase = new Set(resolution.themes.default?.theme.data.baseCss ?? [])
  for (const entry of resolution.themes.themes) {
    const rules = [...new Set((entry.theme.data.baseCss ?? []).filter(text => !mainBase.has(text)).flatMap(globalBaseRules))]
    if (rules.length > 0)
      warn('theme-base-global', entry.theme.id, `baseCss of additional theme '${entry.theme.id}' has rules that style the page: they apply everywhere while its sheet is loaded — also after switching back to the default theme — and compete with the shared sheet's base by sheet order; keep only @font-face, @property and @keyframes there, move the rules to the default theme`, rules)
  }
  for (const c of tokenConflicts)
    warn('token-conflict', `${c.mode}:${c.token}`, `--${c.token} in ${conflictScope(c.mode)} is written by several layers (${c.sources.join(' → ')}), final value: ${c.finalValue}`)
  for (const w of resolution.warnings) {
    if (w.kind === 'override-skipped')
      warn('override-skipped', `${w.theme}/${w.mode}:${w.token}`, `strictTokens dropped the override of '--${w.token}' in ${w.mode === 'root' ? 'root' : `mode '${w.mode}'`} of theme '${w.theme}': neither the theme data nor the component tokens declare it`)
  }
  for (const w of app.warnings) {
    if (w.kind === 'provider-without-manifest')
      warn('provider-without-manifest', w.providerId, 'provider is passed as an object and its baseUrl is not a directory on disk: classes and consumed tokens are unknown; build it with granumProvider()')
    else if (w.kind === 'provider-scanned')
      warn('provider-scanned', w.providerId, 'provider is passed as an object: classes and tokens were scanned from its dist by the application (slow path, no bundle graph); publish granum.manifest.json with granumProvider()')
  }
  // Провайдер, собранный прежней версией granum: в `exports` его пакета есть
  // подпути частей, а манифест их не записал — guard и селекция таких частей не
  // видят. Читать `package.json` доктору можно: он и так ходит по файлам пакета.
  for (const p of resolution.providers) {
    if (p.form !== 'manifest' || !p.baseUrl?.startsWith('file:'))
      continue
    const fromExports = packageSubcomponents(fileURLToPath(p.baseUrl), p.id, p.components.map(c => c.name))
    const missing = Object.entries(fromExports).flatMap(([owner, parts]) => parts.filter(part => p.subcomponents?.get(part) !== owner).map(part => `${part} → ${owner}`))
    if (missing.length > 0)
      warn('subcomponents-missing', p.id, 'package.json#exports has subpaths of compound component parts that the manifest does not record: the provider was built by an older granum — rebuild it, or the guard and the selection do not see these parts', missing)
  }
  const withSelected = new Set(components.map(c => c.providerId))
  for (const p of providers) {
    if (!withSelected.has(p.id) && !p.hasTheme && !p.hasEngine)
      warn('unused-provider', p.id, 'the provider contributes nothing to the build: no selected components, no theme, no engine rules')
  }

  const ordered = [...diagnostics.filter(d => d.level === 'error'), ...diagnostics.filter(d => d.level === 'warn')]
  return {
    engine: {
      name: engine.name,
      ...(engine.version !== undefined ? { version: engine.version } : {}),
      dialect: engine.dialect,
      vocabulary: engine.vocabulary,
    },
    providers,
    components,
    themes: {
      defaultTheme: resolution.themes.default?.theme.id ?? null,
      themeSource: resolution.themes.themeSource ?? null,
      owner: resolution.themes.owner ?? null,
      themes: resolution.themes.themes.map((entry, i) => ({
        id: entry.theme.id,
        default: entry.isDefault,
        modes: entry.modes.map(mode => ({
          name: mode.name,
          value: mode.value,
          colorScheme: mode.colorScheme,
          origin: mode.origin,
          tokens: resolution.tokens.themes[i]?.modes.get(mode.name)?.size ?? 0,
        })),
        modesSource: entry.modesSource,
      })),
      warnings: resolution.themes.warnings,
    },
    tokenConflicts,
    undefinedTokens,
    files: { checked, missing },
    diagnostics: ordered,
    ok: !ordered.some(d => d.level === 'error'),
    clean: ordered.length === 0,
  }
}

export function countDoctorDiagnostics(report: DoctorReport): { errors: number, warnings: number } {
  let errors = 0
  let warnings = 0
  for (const d of report.diagnostics) {
    if (d.level === 'error')
      errors++
    else
      warnings++
  }
  return { errors, warnings }
}

const THEME_SOURCE_TEXT: Record<ThemeSource, string> = {
  app: 'application theme object',
  provider: 'theme in granum.config',
  default: 'defaultTheme of the catalog owner',
}

const MODES_SOURCE_TEXT: Record<ModesSource, string> = {
  explicit: 'modes.names',
  theme: 'default mode of the theme and modes.define',
}

/** Опции текстового вывода доктора. JSON они не касаются. */
export interface DoctorFormatOptions {
  /** Показать все находки этого кода целиком, с перечислениями. */
  readonly code?: string
  /** Сузить вывод до одного компонента: `providerId:Name`. */
  readonly component?: string
  /** Развернуть список выбранных компонентов. */
  readonly components?: boolean
}

/** Сколько элементов перечисления печатать, пока код не выбран явно. */
const ITEMS_PREVIEW = 3

/**
 * Порядок кодов в сводке: сначала то, что ломает сборку, потом то, что делает
 * её неверной молча, потом гигиена. Внутри уровня — по числу находок.
 */
const CODE_SEVERITY: readonly DoctorDiagnosticCode[] = [
  'missing-file',
  'boundary',
  'apply-not-expanded',
  'provider-dialect-mismatch',
  'engine-rules-skipped',
  'provider-classes-dropped',
  'provider-classes-recovered',
  'token-undefined',
  'token-fallback-only',
  'token-conflict',
  'theme-base-global',
  'override-skipped',
  'css-double-delivery',
  'important-in-provider-css',
  'safelist-dead',
  'safelist-redundant',
  'peer-missing',
  'provider-without-manifest',
  'provider-scanned',
  'unused-provider',
  'component-theme-unknown',
  'component-mode-missing',
  'theme-mode-missing',
  'mode-extends-unresolved',
  'mode-extends-cycle',
]

function severityOf(code: string): number {
  const index = CODE_SEVERITY.indexOf(code as DoctorDiagnosticCode)
  return index === -1 ? CODE_SEVERITY.length : index
}

/**
 * Относится ли находка к компоненту.
 *
 * Сравнение точное, а не подстрокой: `@x/kit:C3` подстрокой попадает и в
 * `@x/kit:C30`. Формы subject у находок три — сам ключ, `ключ:--токен` и список
 * владельцев через запятую, — и все три разбираются здесь.
 */
function subjectMatchesComponent(subject: string, key: string): boolean {
  return subject.split(', ').some(part => part === key || part.startsWith(`${key}:`))
}

/** Строка находки: сообщение плюс перечисление — свёрнутое или целиком. */
function diagnosticLine(d: DoctorDiagnostic, expand: boolean): string {
  const mark = d.level === 'error' ? '✗' : '⚠'
  const head = `  ${mark} [${d.code}] ${d.subject} — ${d.message}`
  if (!d.items?.length)
    return head
  if (expand)
    return `${head}\n      ${d.items.join(' ')}`
  const preview = d.items.slice(0, ITEMS_PREVIEW).join(' ')
  const rest = d.items.length - ITEMS_PREVIEW
  return `${head} (${d.items.length}): ${preview}${rest > 0 ? ` … +${rest}` : ''}`
}

/**
 * Текстовый отчёт доктора.
 *
 * Разворачивать всё подряд нельзя: на дизайн-системе из восьми пакетов это 74
 * находки, 116 компонентов и перечисления по несколько десятков классов в
 * строке — формально верно, практически нечитаемо. Поэтому по умолчанию:
 *
 *   - **ошибки печатаются целиком и первыми**: они ломают сборку, и прятать их
 *     за флагом нельзя ни при каком объёме;
 *   - предупреждения сводятся в таблицу по кодам с числами, в порядке серьёзности;
 *   - перечисление внутри находки сворачивается до трёх элементов и счётчика;
 *   - список компонентов сворачивается в одну строку с суммами.
 *
 * Детали — по требованию: `--code=<code>` печатает все находки одного кода с
 * полными перечислениями, `--component=<providerId:Name>` сужает всё до одного
 * компонента, `--components` разворачивает список.
 */
export function formatDoctorReport(report: DoctorReport, options: DoctorFormatOptions = {}): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)
  const { code: onlyCode, component: onlyComponent } = options

  push('granum doctor')
  push('=============')
  push()
  // Движок называется первым: от него зависит и список классов каждого пакета,
  // и то, какие правила вообще будут исполнены.
  push(`Engine: ${report.engine.name}${report.engine.version ? ` ${report.engine.version}` : ''} — dialect ${report.engine.dialect}, vocabulary ${report.engine.vocabulary}`)
  push()

  push(`Providers (${report.providers.length}):`)
  for (const p of report.providers) {
    const extra: string[] = [`components: ${p.components}`]
    if (p.hasTheme)
      extra.push('theme: yes')
    if (p.hasEngine)
      extra.push('engine rules: yes')
    // Диалект рядом с формой: он объясняет и пересчёт, и пропущенные правила.
    extra.push(`dialect: ${p.dialect ?? 'none'}`)
    if (p.dialect !== null && p.vocabulary !== report.engine.vocabulary)
      extra.push(`classes: ${p.classSource}`)
    push(`  • ${p.id} [${p.form}${p.version ? ` ${p.version}` : ''}] — ${extra.join(', ')}`)
  }
  push()

  const components = onlyComponent ? report.components.filter(c => c.key === onlyComponent) : report.components
  const expandComponents = options.components === true || onlyComponent !== undefined || components.length <= 12
  const totals = components.reduce(
    (acc, c) => ({ classes: acc.classes + c.classes, safelist: acc.safelist + c.safelist, css: acc.css + c.css }),
    { classes: 0, safelist: 0, css: 0 },
  )
  push(`Selected components (${components.length}, order = deps → dependents) — classes ${totals.classes}, safelist ${totals.safelist}, css ${totals.css}:`)
  if (expandComponents) {
    for (const c of components) {
      const extra: string[] = []
      if (c.dependencies.length)
        extra.push(`deps: [${c.dependencies.join(', ')}]`)
      extra.push(`classes: ${c.classes}`)
      if (c.safelist)
        extra.push(`safelist: ${c.safelist}`)
      if (c.css)
        extra.push(`css: ${c.css}`)
      if (c.group)
        extra.push(`group: ${c.group}`)
      push(`  • ${c.key} — ${extra.join(', ')}`)
    }
  }
  else {
    push(`  (list collapsed: --components to expand, --component=<providerId:Name> for one)`)
  }
  push()

  const t = report.themes
  push(`Theme: ${t.defaultTheme ?? '—'}${t.themeSource ? ` (source: ${THEME_SOURCE_TEXT[t.themeSource]}${t.owner ? `, catalog of ${t.owner}` : ''})` : ''}`)
  for (const theme of t.themes) {
    const role = theme.default ? 'default, main sheet' : 'own sheet'
    push(`${theme.id} (${role}) — modes: [${theme.modes.map(m => m.name).join(', ') || '—'}] (source: ${MODES_SOURCE_TEXT[theme.modesSource]})`)
    for (const m of theme.modes)
      push(`  • ${m.name} → ${m.value} (${m.colorScheme}${m.origin === 'define' ? ', modes.define' : ''}, ${m.tokens} token(s))`)
  }
  push()
  push(`Files checked: ${report.files.checked}${report.files.missing.length ? `, missing: ${report.files.missing.length}` : ''}`)
  push()

  const selected = report.diagnostics.filter(d =>
    (onlyCode === undefined || d.code === onlyCode)
    && (onlyComponent === undefined || subjectMatchesComponent(d.subject, onlyComponent)),
  )
  const { errors, warnings } = countDoctorDiagnostics(report)

  if (onlyCode !== undefined || onlyComponent !== undefined) {
    const filter = [onlyCode && `code ${onlyCode}`, onlyComponent && `component ${onlyComponent}`].filter(Boolean).join(', ')
    push(`Diagnostics for ${filter} (${selected.length} of ${report.diagnostics.length}):`)
    for (const d of selected)
      push(diagnosticLine(d, true))
    push()
  }
  else if (report.diagnostics.length) {
    // Ошибки — целиком и первыми: они ломают сборку.
    const errorList = report.diagnostics.filter(d => d.level === 'error')
    const warnList = report.diagnostics.filter(d => d.level === 'warn')
    push(`Diagnostics (errors: ${errors}, warnings: ${warnings}):`)
    for (const d of errorList)
      push(diagnosticLine(d, true))
    if (warnList.length <= 12) {
      for (const d of warnList)
        push(diagnosticLine(d, false))
    }
    else {
      const byCode = new Map<string, number>()
      for (const d of warnList)
        byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1)
      const rows = [...byCode].sort((a, b) => severityOf(a[0]) - severityOf(b[0]) || b[1] - a[1])
      const width = Math.max(...rows.map(([c]) => c.length))
      for (const [codeName, count] of rows)
        push(`  ⚠ ${codeName.padEnd(width)}  ${String(count).padStart(4)}   --code=${codeName}`)
    }
    push()
  }

  if (!report.ok)
    push(`✗ Errors found: ${errors}.`)
  else if (warnings)
    push(`✓ OK — no errors; warnings: ${warnings} (they only fail with --strict).`)
  else
    push('✓ OK — clean.')
  return lines.join('\n')
}
