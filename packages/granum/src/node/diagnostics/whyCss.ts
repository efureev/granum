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

export type WhyCssVia = 'manifest-classes' | 'safelist' | 'component-css' | 'app-source' | 'manifest-lost'

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
  /**
   * Почему правила нет, через словари (D-E3): чем отфильтрован артефакт пакета,
   * откуда взялся класс и что у движка приложения. Заполняется только когда
   * правила нет и класс пришёл из пакета.
   */
  readonly dialects: {
    readonly appDialect: string
    readonly appVocabulary: string
    readonly appEngine: string
    readonly providers: readonly {
      readonly id: string
      readonly dialect: string | null
      readonly engineName: string | null
      readonly rulesSkipped: boolean
      readonly lost: boolean
    }[]
  } | null
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
  // Класс, который был в манифесте и потерялся при пересчёте, источником тоже
  // считается: иначе ответ «источников не найдено» прячет самое важное.
  for (const decision of app.engineDecisions) {
    if (decision.lost.includes(className))
      hits.push({ via: 'manifest-lost', component: decision.providerId })
  }

  const out = await app.engine.generate({ classes: new Set([className]), ...app.engineContribution })
  const rule = out.matched.get(className) ?? null
  const fromProviders = new Set(hits.filter(h => h.via !== 'app-source').map(h => (h.component ?? '').split(':')[0]))
  const dialects = rule === null && fromProviders.size > 0
    ? {
        appDialect: app.engine.dialect,
        appVocabulary: app.engine.vocabulary,
        appEngine: app.engine.name,
        providers: app.engineDecisions
          .filter(d => fromProviders.has(d.providerId))
          .map(d => ({
            id: d.providerId,
            dialect: d.dialect,
            engineName: d.engineName,
            rulesSkipped: d.rulesSkipped,
            lost: d.lost.includes(className),
          })),
      }
    : null
  return { className, hits, rule, found: hits.length > 0, dialects }
}

const VIA_TEXT: Record<WhyCssVia, string> = {
  'manifest-classes': 'static class of a component (manifest)',
  'safelist': 'component safelist',
  'component-css': 'selector in a component CSS file',
  'app-source': 'application source',
  'manifest-lost': 'class from the package manifest that the application engine could not re-extract',
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
  if (report.dialects) {
    const d = report.dialects
    push()
    push(`Vocabularies: the application runs '${d.appEngine}' speaking '${d.appDialect}' (vocabulary ${d.appVocabulary}).`)
    for (const provider of d.providers) {
      push(`  • ${provider.id}: built by '${provider.engineName ?? 'unknown engine'}' for dialect '${provider.dialect ?? 'none'}'`
        + `${provider.rulesSkipped ? ', its engine rules were NOT loaded (foreign dialect)' : ''}`
        + `${provider.lost ? ', this class survived only as a manifest entry' : ''}`)
    }
    push()
    push('Fix it one of two ways: run an engine of the package dialect, or add a rule for this class to your engine factory')
    push('(for example miniEngine({ rules: [[…]] })) — granum will then find it on the next build.')
  }
  return lines.join('\n')
}
