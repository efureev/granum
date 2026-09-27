/**
 * `granum doctor` (D-2): полный отчёт о конфигурации приложения по манифестам,
 * без сборки. Уровни: `error` — обязано сломать сборку (файла нет, директива
 * не раскрыта, граница нарушена); `warn` — законно, но подозрительно; падает
 * только под `--strict` (INV-ERR-3).
 */
import type { ResolvedThemeWarning, ThemeNamesSource } from '../../core/resolveThemes'
import type { ProviderClassSource } from '../dialects'
import type { PreparedApp } from '../prepare'
import { existsSync, readFileSync } from 'node:fs'
import { isLoadedManifest } from '../../contract/manifest'
import { sortedUnique } from '../../core/dedupe'
import { scanCssDeclarations } from '../cssDeclarations'
import { boundaryKindOf, collectImportSpecifiers } from '../imports'
import { resolveInlinedCssSources, resolveProviderPath } from '../inlinedCss'
import { patternMatcher } from '../tokenPrune'

export interface DoctorProviderInfo {
  readonly id: string
  readonly form: 'manifest' | 'object'
  readonly version?: string
  readonly components: number
  readonly hasTheme: boolean
  readonly hasEngine: boolean
  /** Словарь артефакта; `null` — пакет ни от какого словаря не зависит (D-E2). */
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

export interface DoctorTokenConflict {
  readonly theme: string
  readonly selector: string
  readonly token: string
  readonly sources: readonly string[]
  readonly finalValue: string
}

export type DoctorDiagnosticCode
  = | 'missing-file'
    | 'apply-not-expanded'
    | 'boundary'
    | 'theme-warning'
    | 'token-conflict'
    | 'token-undefined'
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

export interface DoctorDiagnostic {
  readonly level: 'error' | 'warn'
  readonly code: DoctorDiagnosticCode
  readonly subject: string
  readonly message: string
  /**
   * Перечисление, которое относится к находке: классы safelist, потерянные
   * имена, файлы. Отдельным полем, а не внутри `message`, потому что текстовый
   * вывод сворачивает его в счётчик и разворачивает по `--code=` (D-8).
   */
  readonly items?: readonly string[]
}

export interface DoctorReport {
  /** Движок приложения: реализация, словарь и его отпечаток (D-E1). */
  readonly engine: {
    readonly name: string
    readonly version?: string
    readonly dialect: string
    readonly vocabulary: string
  }
  readonly providers: readonly DoctorProviderInfo[]
  readonly components: readonly DoctorComponentInfo[]
  readonly themes: {
    readonly names: readonly string[]
    readonly namesSource: ThemeNamesSource
    readonly blocks: readonly { readonly theme: string, readonly selector: string, readonly tokens: number }[]
    readonly warnings: readonly ResolvedThemeWarning[]
  }
  readonly tokenConflicts: readonly DoctorTokenConflict[]
  /** Потребляется выбранным компонентом, но не объявлен ни одним слоем (T-5). */
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
    case 'theme-extends-cycle': return w.chain.join(' → ')
    case 'multiple-default-themes': return w.themes.join(', ')
    case 'default-theme-without-source': return `${w.providerId}:${w.theme}`
    default: return w.theme
  }
}

export function formatThemeWarning(w: ResolvedThemeWarning): string {
  switch (w.kind) {
    case 'theme-extends-unresolved':
      return `theme "${w.theme}" extends "${w.base}", but there is nothing to inherit: ${w.reason === 'unknown' ? 'no provider supplies a theme with that name' : 'the theme comes as a ready-made CSS file, its values are opaque'}`
    case 'theme-extends-cycle':
      return `cycle in themes.define[].extends: ${w.chain.join(' → ')} — the chain is cut`
    case 'default-theme-without-source':
      return `${w.providerId} lists "${w.theme}" in defaultThemes but does not supply it`
    case 'partial-theme':
      return `theme "${w.theme}" is not covered by every provider — missing from: ${w.providersWithout.join(', ')}`
    case 'multiple-default-themes':
      return `several themes are active by default: [${w.themes.join(', ')}] — with overlapping selectors the last one wins`
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
      hasTheme: Object.keys(p.theme.themes).length > 0 || p.theme.tokensCss !== undefined || p.theme.baseCss !== undefined || Object.keys(p.theme.tokenDefinitions).length > 0,
      hasEngine: p.engine !== undefined || (p.engineArtifact?.module ?? null) !== null,
      dialect: decision?.dialect ?? p.engineArtifact?.dialect ?? null,
      vocabulary: decision?.vocabulary ?? p.engineArtifact?.vocabulary ?? null,
      engineName: decision?.engineName ?? p.engineArtifact?.name ?? null,
      classSource: decision?.classes ?? 'manifest',
      rulesLoaded: decision?.rulesLoaded ?? false,
    }
  })

  /*
   * Расхождение словарей (D-E2). Совпавший диалект при разошедшихся отпечатках
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

  const blocks: { theme: string, selector: string, tokens: number }[] = []
  for (const [theme, entry] of Object.entries(resolution.themes.tokenRegistry)) {
    for (const block of entry.blocks)
      blocks.push({ theme, selector: block.selector, tokens: Object.keys(block.tokens).length })
  }

  // Конфликты — по тем же слоям, из которых эмитится CSS (INV-DIAG-1).
  const tokenConflicts: DoctorTokenConflict[] = []
  const definedTokens = new Set<string>()
  for (const layerBlocks of resolution.tokenLayers.values()) {
    for (const block of layerBlocks) {
      for (const chain of block.tokens.values()) {
        if (chain.effective !== undefined)
          definedTokens.add(`--${chain.token}`)
        const emitted = chain.layers.filter(l => l.skipped === undefined)
        if (emitted.length >= 2)
          tokenConflicts.push({ theme: chain.theme, selector: chain.selector, token: chain.token, sources: emitted.map(l => l.source), finalValue: chain.effective! })
      }
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
  for (const source of resolveInlinedCssSources(resolution)) {
    const css = readIfExists(source.path, `${source.providerId} (${source.kind}${source.theme ? ` ${source.theme}` : ''})`)
    if (css === undefined)
      continue
    for (const decl of scanCssDeclarations(css))
      definedTokens.add(`--${decl.token}`)
  }
  for (const provider of resolution.providers) {
    for (const t of provider.theme.declares)
      definedTokens.add(t)
    for (const set of Object.values(provider.theme.tokenDefinitions)) {
      for (const t of Object.keys(set.tokens))
        definedTokens.add(`--${t}`)
    }
    for (const component of provider.components) {
      for (const set of Object.values(component.tokenDefinitions)) {
        for (const t of Object.keys(set.tokens))
          definedTokens.add(`--${t}`)
      }
    }
  }
  for (const { provider, component } of resolution.selection.entries) {
    const key = `${provider.id}:${component.name}`
    for (const path of component.css) {
      const css = readIfExists(resolveProviderPath(path, provider.baseUrl), key)
      if (css === undefined)
        continue
      if (/@apply\s/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')))
        error('apply-not-expanded', key, `${path} still contains @apply — rebuild the provider with granumProvider()`)
      if (/!\s*important/i.test(css))
        warn('important-in-provider-css', key, `${path} uses !important — inside cascade layers it inverts the layer order (ADR-4)`)
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
            error('boundary', key, `${file} imports '${spec}' (${kind}) — browser code of a provider must not reach node (INV-BND-1)`)
        }
      }
    }
  }

  // Манифестные предупреждения провайдеров — доносятся до приложения (M-1),
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
        warn('css-double-delivery', subject, 'component CSS is both inlined by granum and imported by its chunk — it arrives twice (INV-CSS-5)', (w.files as string[] | undefined) ?? [])
      else if (w.code === 'peer-missing')
        warn('peer-missing', provider.id, `depends on provider '${String(w.provider)}' but does not list it in peerDependencies (C-5)`)
    }
  }

  /*
   * Токены: нужен компоненту извне, не даёт никто (T-5).
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
   *     уважает (C-14), доктор обязан уважать так же.
   *
   * До этого проверялся весь `consumes`, и на дизайн-системе из 84 компонентов
   * находок было 279 при одной настоящей: `--strict` от такого шума непригоден.
   */
  const undefinedTokens: { token: string, component: string }[] = []
  for (const { provider, component } of resolution.selection.entries) {
    // Полный ответ «что нужно извне» считается на сборке пакета и лежит в
    // манифесте: код компонента, его CSS и классы safelist минус то, что он
    // присваивает сам. Доктору считать тут нечего.
    const consumed = new Set(component.requiresTokens)
    const dynamic = component.dynamicTokens.map(patternMatcher)
    for (const token of [...consumed].sort()) {
      if (definedTokens.has(token) || token.startsWith('--un-') || dynamic.some(match => match(token)))
        continue
      const key = `${provider.id}:${component.name}`
      undefinedTokens.push({ token, component: key })
      warn('token-undefined', `${key}:${token}`, `token '${token}' is consumed by ${key} but no granum layer defines it for any active theme — it may still come from the application CSS or an engine rule`)
    }
  }

  // Safelist без правила у движка — мёртвая запись (INV-DIAG-2).
  const safelistAll = sortedUnique(resolution.selection.entries.flatMap(e => e.component.safelist))
  if (safelistAll.length > 0) {
    const out = await engine.generate({ classes: new Set(safelistAll), ...app.engineContribution })
    for (const dead of out.unmatched) {
      const owners = resolution.selection.entries.filter(e => e.component.safelist.includes(dead)).map(e => `${e.provider.id}:${e.component.name}`)
      warn('safelist-dead', owners.join(', '), `safelist entry '${dead}' has no rule in the engine — it produces no CSS`)
    }
  }

  for (const w of resolution.themes.warnings)
    warn('theme-warning', themeWarningSubject(w), formatThemeWarning(w))
  for (const c of tokenConflicts)
    warn('token-conflict', `${c.theme}:${c.token}`, `${c.selector} { --${c.token} } is written by several layers (${c.sources.join(' → ')}), final value: ${c.finalValue}`)
  for (const w of resolution.warnings) {
    if (w.kind === 'override-skipped')
      warn('override-skipped', `${w.theme}:${w.token}`, `strictTokens dropped the override of '--${w.token}' in theme '${w.theme}': no package layer declares it`)
  }
  for (const w of app.warnings) {
    if (w.kind === 'provider-without-manifest')
      warn('provider-without-manifest', w.providerId, 'provider is passed as an object and its baseUrl is not a directory on disk: classes and consumed tokens are unknown; build it with granumProvider()')
    else if (w.kind === 'provider-scanned')
      warn('provider-scanned', w.providerId, 'provider is passed as an object: classes and tokens were scanned from its dist by the application (slow path, no bundle graph); publish granum.manifest.json with granumProvider()')
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
    themes: { names: resolution.themes.names, namesSource: resolution.themes.namesSource, blocks, warnings: resolution.themes.warnings },
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

const NAMES_SOURCE_TEXT: Record<ThemeNamesSource, string> = {
  'explicit': 'themes.names',
  'app-defined': 'keys of themes.define',
  'provider-defaults': 'providers\' defaultThemes',
  'fallback': 'core fallback',
}

/** Опции текстового вывода доктора (D-8). JSON они не касаются. */
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
  'token-conflict',
  'override-skipped',
  'css-double-delivery',
  'important-in-provider-css',
  'safelist-dead',
  'safelist-redundant',
  'peer-missing',
  'provider-without-manifest',
  'provider-scanned',
  'unused-provider',
  'theme-warning',
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
  // и то, какие правила вообще будут исполнены (D-E1, D-E2).
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

  push(`Themes: [${report.themes.names.join(', ') || '—'}] (source: ${NAMES_SOURCE_TEXT[report.themes.namesSource]})`)
  for (const b of report.themes.blocks)
    push(`  • ${b.theme} → ${b.selector} (${b.tokens} token(s))`)
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
