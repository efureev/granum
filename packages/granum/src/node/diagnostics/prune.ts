import type { PreparedApp } from '../prepare'
/**
 * `granum prune`: что обрезка удалит и что сохранит — без изменения эмиссии.
 * План считается тем же `planTokenPrune`, что и сборка (INV-DIAG-1).
 */
import type { TokenKeepReason } from '../tokenPrune'
import { Buffer } from 'node:buffer'
import { readCss } from '../css'
import { scanCssDeclarations } from '../cssDeclarations'
import { resolveInlinedCssSources, resolveProviderPath } from '../inlinedCss'
import { pruneCssDeclarations } from '../pruneCssDeclarations'
import { planTokenPrune } from '../tokenPrune'

export interface TokenPruneFileReport {
  readonly path: string
  readonly kind: 'tokens' | 'base' | 'theme'
  readonly providerId: string
  readonly theme?: string
  readonly skipped: boolean
  readonly declared: number
  readonly kept: number
  readonly removed: number
  readonly bytesBefore: number
  readonly bytesAfter: number
}

export interface TokenPruneReport {
  readonly mode: string
  readonly files: readonly TokenPruneFileReport[]
  readonly kept: readonly { readonly token: string, readonly reason: TokenKeepReason }[]
  readonly removed: readonly string[]
  readonly deadPatterns: readonly string[]
  readonly appSourcesScanned: number
  readonly bytesBefore: number
  readonly bytesAfter: number
}

export async function granumTokenPrune(app: PreparedApp): Promise<TokenPruneReport> {
  const { resolution, config } = app
  const byId = new Map(resolution.providers.map(p => [p.id, p]))
  const sources = resolveInlinedCssSources(resolution)
  const inlined = await Promise.all(sources.map(async source => ({ source, css: await readCss(source.path) })))
  const componentCss = await Promise.all(resolution.componentCss.map(ref => readCss(resolveProviderPath(ref.path, byId.get(ref.providerId)?.baseUrl))))

  const plan = planTokenPrune({
    resolution,
    options: config.pruneTokens,
    tokenOverrides: config.themes?.tokenOverrides,
    inlined,
    componentCss,
    appConsumes: app.appScan.consumes,
  })

  const files: TokenPruneFileReport[] = inlined.map(({ source, css }) => {
    const declared = new Set(scanCssDeclarations(css).map(d => d.token))
    const skipped = source.kind === 'base'
    const result = skipped ? { css, removed: [] as string[] } : pruneCssDeclarations(css, plan.isKept)
    return {
      path: source.path,
      kind: source.kind,
      providerId: source.providerId,
      ...(source.theme !== undefined ? { theme: source.theme } : {}),
      skipped,
      declared: declared.size,
      kept: declared.size - result.removed.length,
      removed: result.removed.length,
      bytesBefore: Buffer.byteLength(css),
      bytesAfter: Buffer.byteLength(result.css),
    }
  })

  return {
    mode: config.pruneTokens?.mode ?? 'off',
    files,
    kept: [...plan.kept.entries()].map(([token, reason]) => ({ token, reason })).sort((a, b) => a.token.localeCompare(b.token, 'en')),
    removed: plan.removable,
    deadPatterns: plan.deadPatterns,
    appSourcesScanned: app.appScan.files.length,
    bytesBefore: files.reduce((n, f) => n + f.bytesBefore, 0),
    bytesAfter: files.reduce((n, f) => n + f.bytesAfter, 0),
  }
}

function reasonText(reason: TokenKeepReason): string {
  switch (reason.kind) {
    case 'usage': return 'consumed by a selected component'
    case 'inlined-rule': return 'used by a rule in an inlined file'
    case 'component-css': return 'used by component CSS'
    case 'override': return 'written by tokenOverrides'
    case 'structural': return 'defined by a structural layer'
    case 'app-source': return 'used by application sources'
    case 'keep-pattern': return `matches keep pattern ${reason.pattern}`
    case 'referenced-by': return `referenced by the value of --${reason.by}`
  }
}

export function formatTokenPruneReport(report: TokenPruneReport, cwd: string): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)
  push('granum prune')
  push('============')
  push()
  push(`Mode in config: ${report.mode} (this command never changes the emission)`)
  push(`Application sources scanned: ${report.appSourcesScanned} file(s)`)
  push()
  push(`Files (${report.files.length}):`)
  for (const f of report.files) {
    const rel = f.path.startsWith(cwd) ? f.path.slice(cwd.length + 1) : f.path
    push(`  • ${rel} [${f.kind}${f.theme ? ` ${f.theme}` : ''}] — ${f.skipped ? 'not pruned (base)' : `declared ${f.declared}, kept ${f.kept}, removed ${f.removed}`}; ${f.bytesBefore} → ${f.bytesAfter} bytes`)
  }
  push()
  push(`Removed (${report.removed.length}): ${report.removed.map(t => `--${t}`).join(' ') || '—'}`)
  push()
  push(`Kept (${report.kept.length}):`)
  for (const k of report.kept)
    push(`  • --${k.token} — ${reasonText(k.reason)}`)
  if (report.deadPatterns.length) {
    push()
    push(`Dead patterns (${report.deadPatterns.length}) — matched no declared token: ${report.deadPatterns.join(', ')}`)
  }
  push()
  push(`Total: ${report.bytesBefore} → ${report.bytesAfter} bytes (−${report.bytesBefore - report.bytesAfter})`)
  return lines.join('\n')
}
