/**
 * `granum why-css <class>` (D-3): каким каналом класс попал в CSS и каким
 * правилом движка он сгенерирован.
 */
import type { EngineMatch } from '../../engine/types'
import type { PreparedApp } from '../prepare'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { DEFAULT_APP_EXTENSIONS, listSourceFiles } from '../appSources'
import { resolveProviderPath } from '../inlinedCss'

export type WhyCssVia = 'manifest-classes' | 'safelist' | 'component-css' | 'app-source'

export interface WhyCssHit {
  readonly via: WhyCssVia
  readonly component?: string
  readonly file?: string
}

export interface WhyCssReport {
  readonly className: string
  readonly hits: readonly WhyCssHit[]
  /** Правило движка, породившее утилиту; `null` — правила нет. */
  readonly rule: EngineMatch | null
  readonly found: boolean
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cssContainsClass(css: string, className: string): boolean {
  return new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`).test(css.replace(/\\(.)/g, '$1'))
}

function sourceContainsClass(source: string, className: string): boolean {
  return new RegExp(`(?<![\\w-])${escapeRegExp(className)}(?![\\w-])`).test(source)
}

export async function granumWhyCss(app: PreparedApp, className: string): Promise<WhyCssReport> {
  const { resolution } = app
  const hits: WhyCssHit[] = []
  for (const { provider, component } of resolution.selection.entries) {
    const key = `${provider.id}:${component.name}`
    if (component.classes.includes(className))
      hits.push({ via: 'manifest-classes', component: key })
    if (component.safelist.includes(className))
      hits.push({ via: 'safelist', component: key })
    for (const path of component.css) {
      try {
        const css = readFileSync(resolveProviderPath(path, provider.baseUrl), 'utf8')
        if (cssContainsClass(css, className))
          hits.push({ via: 'component-css', component: key, file: path })
      }
      catch {
        // Нечитаемый CSS показывает doctor, а не ответ на вопрос про класс.
      }
    }
  }
  if (app.appScan.classes.includes(className)) {
    const extensions = app.config.appSources?.extensions ?? DEFAULT_APP_EXTENSIONS
    for (const dir of app.config.appSources?.dirs ?? []) {
      for (const file of listSourceFiles(resolve(app.root, dir), extensions)) {
        try {
          if (sourceContainsClass(readFileSync(file, 'utf8'), className))
            hits.push({ via: 'app-source', file: relative(app.root, file) })
        }
        catch {
          continue
        }
      }
    }
  }
  const out = await app.engine.generate({ classes: new Set([className]), ...app.engineContribution })
  return { className, hits, rule: out.matched.get(className) ?? null, found: hits.length > 0 }
}

const VIA_TEXT: Record<WhyCssVia, string> = {
  'manifest-classes': 'static class of a component (manifest)',
  'safelist': 'component safelist',
  'component-css': 'selector in a component CSS file',
  'app-source': 'application source',
}

export function formatWhyCssReport(report: WhyCssReport): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)
  const title = `granum why-css ${report.className}`
  push(title)
  push('='.repeat(title.length))
  push()
  push(report.rule
    ? `Rule: ${report.rule.rule} (source: ${report.rule.source}, layer: ${report.rule.layer}, selector: ${report.rule.selector})`
    : 'Rule: none — the engine has no rule for this class (a hook class or a typo)')
  push()
  if (!report.found) {
    push('No sources found among the selected components and application sources.')
    return lines.join('\n')
  }
  push(`Sources (${report.hits.length}):`)
  for (const hit of report.hits)
    push(`  • ${VIA_TEXT[hit.via]}: ${hit.component ?? ''}${hit.file ? ` — ${hit.file}` : ''}`)
  return lines.join('\n')
}
