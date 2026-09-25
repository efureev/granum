/**
 * `granum doctor` (D-2): полный отчёт о конфигурации приложения по манифестам,
 * без сборки. Уровни: `error` — обязано сломать сборку (файла нет, директива
 * не раскрыта, граница нарушена); `warn` — законно, но подозрительно; падает
 * только под `--strict` (INV-ERR-3).
 */
import type { ResolvedThemeWarning, ThemeNamesSource } from '../../core/resolveThemes'
import type { PreparedApp } from '../prepare'
import { existsSync, readFileSync } from 'node:fs'
import { isLoadedManifest } from '../../contract/manifest'
import { sortedUnique } from '../../core/dedupe'
import { scanCssDeclarations } from '../cssDeclarations'
import { boundaryKindOf, collectImportSpecifiers } from '../imports'
import { resolveInlinedCssSources, resolveProviderPath } from '../inlinedCss'
import { extractTokenUses } from '../tokenScan'

export interface DoctorProviderInfo {
  readonly id: string
  readonly form: 'manifest' | 'object'
  readonly version?: string
  readonly components: number
  readonly hasTheme: boolean
  readonly hasEngine: boolean
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
    | 'important-in-provider-css'
    | 'override-skipped'
    | 'provider-without-manifest'
    | 'unused-provider'

export interface DoctorDiagnostic {
  readonly level: 'error' | 'warn'
  readonly code: DoctorDiagnosticCode
  readonly subject: string
  readonly message: string
}

export interface DoctorReport {
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
  const warn = (code: DoctorDiagnosticCode, subject: string, message: string): void => {
    diagnostics.push({ level: 'warn', code, subject, message })
  }
  const error = (code: DoctorDiagnosticCode, subject: string, message: string): void => {
    diagnostics.push({ level: 'error', code, subject, message })
  }

  const providers: DoctorProviderInfo[] = resolution.providers.map(p => ({
    id: p.id,
    form: p.form,
    ...(isLoadedManifest(p.source) ? { version: p.source.manifest.version } : {}),
    components: p.components.length,
    hasTheme: Object.keys(p.theme.themes).length > 0 || p.theme.tokensCss !== undefined || p.theme.baseCss !== undefined || Object.keys(p.theme.tokenDefinitions).length > 0,
    hasEngine: p.engine !== undefined || p.engineModule !== null,
  }))

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
        warn('safelist-redundant', subject, `safelist duplicates statically extracted classes: ${(w.classes as string[] | undefined)?.join(', ') ?? ''}`)
      else if (w.code === 'css-double-delivery')
        warn('css-double-delivery', subject, `component CSS is both inlined by granum and imported by its chunk (${(w.files as string[] | undefined)?.join(', ') ?? ''}) — it arrives twice (INV-CSS-5)`)
    }
  }

  // Токены: потребляется выбранным компонентом, объявлено никем (T-5).
  const undefinedTokens: { token: string, component: string }[] = []
  for (const { provider, component } of resolution.selection.entries) {
    const consumed = new Set(component.consumesTokens)
    for (const klass of component.safelist) {
      for (const t of extractTokenUses(klass).keys())
        consumed.add(`--${t}`)
    }
    for (const token of [...consumed].sort()) {
      if (definedTokens.has(token) || token.startsWith('--un-'))
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
      warn('provider-without-manifest', w.providerId, 'provider is passed as an object: its classes and consumed tokens are unknown; build it with granumProvider()')
  }
  const withSelected = new Set(components.map(c => c.providerId))
  for (const p of providers) {
    if (!withSelected.has(p.id) && !p.hasTheme && !p.hasEngine)
      warn('unused-provider', p.id, 'the provider contributes nothing to the build: no selected components, no theme, no engine rules')
  }

  const ordered = [...diagnostics.filter(d => d.level === 'error'), ...diagnostics.filter(d => d.level === 'warn')]
  return {
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

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)
  push('granum doctor')
  push('=============')
  push()
  push(`Providers (${report.providers.length}):`)
  for (const p of report.providers)
    push(`  • ${p.id} [${p.form}${p.version ? ` ${p.version}` : ''}] — components: ${p.components}${p.hasTheme ? ', theme: yes' : ''}${p.hasEngine ? ', engine: yes' : ''}`)
  push()
  push(`Selected components (${report.components.length}, order = deps → dependents):`)
  for (const c of report.components) {
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
  push()
  push(`Themes: [${report.themes.names.join(', ') || '—'}] (source: ${NAMES_SOURCE_TEXT[report.themes.namesSource]})`)
  for (const b of report.themes.blocks)
    push(`  • ${b.theme} → ${b.selector} (${b.tokens} token(s))`)
  push()
  push(`Files checked: ${report.files.checked}${report.files.missing.length ? `, missing: ${report.files.missing.length}` : ''}`)
  push()
  const { errors, warnings } = countDoctorDiagnostics(report)
  if (report.diagnostics.length) {
    push(`Diagnostics (errors: ${errors}, warnings: ${warnings}):`)
    for (const d of report.diagnostics)
      push(`  ${d.level === 'error' ? '✗' : '⚠'} [${d.code}] ${d.subject} — ${d.message}`)
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
