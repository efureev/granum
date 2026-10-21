/**
 * `granum themes <config>`: каталог тем графа по индексу манифеста владельца —
 * id, название, родитель, режимы, ссылка на дизайн-систему. Данные тем
 * не читаются: индекс манифеста для того и записан.
 */
import type { GranumConfig } from '../../config'
import type { GranumThemeChoice, ThemeTargetCheck } from '../../core/resolveThemes'
import { toProviderNode } from '../../core/providerNode'
import { checkThemeTargets, defaultThemeIndex, findThemeOwner, normalizeThemeEntry, splitThemeKey } from '../../core/resolveThemes'
import { loadProviderInputs } from '../prepare'

export interface ThemesCatalogEntry {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly docs?: string
  readonly extends?: string
  /** Режимы из индекса; у объектного провайдера без манифеста неизвестны. */
  readonly modes?: readonly string[]
  readonly defaultMode?: string
  /** Версия темы (C-41). */
  readonly version?: string
  /** Сверка `targets` с пакетами графа (A-38). */
  readonly targets?: readonly ThemeTargetCheck[]
}

export interface ThemesReport {
  /** Владелец каталога; `null` — тем в графе нет. */
  readonly owner: string | null
  /** `defaultTheme` каталога. */
  readonly defaultTheme: string | null
  /** Основная тема сборки: отмеченная в `themes` или `defaultTheme` каталога; тема-объект — её id. */
  readonly main: string | null
  /** Дополнительные темы сборки — своими листами. */
  readonly built: readonly string[]
  readonly themes: readonly ThemesCatalogEntry[]
}

export function granumThemes(config: GranumConfig, root: string): ThemesReport {
  const nodes = loadProviderInputs(config, root).map(toProviderNode)
  const owner = findThemeOwner(nodes)
  const graph = new Map(nodes.map(node => [node.id, node]))
  const themes = Object.entries(owner?.theme.catalog ?? {}).map(([id, entry]) => ({
    id,
    title: entry.title,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.docs !== undefined ? { docs: entry.docs } : {}),
    ...(entry.extends !== undefined ? { extends: entry.extends } : {}),
    ...(entry.modes !== undefined ? { modes: entry.modes } : {}),
    ...(entry.defaultMode !== undefined ? { defaultMode: entry.defaultMode } : {}),
    ...(entry.version !== undefined ? { version: entry.version } : {}),
    ...(entry.targets !== undefined ? { targets: checkThemeTargets(entry, graph) } : {}),
  }))
  const entries = (config.themes ?? []).map(normalizeThemeEntry)
  const idOf = (choice: GranumThemeChoice): string => (typeof choice === 'string' ? splitThemeKey(choice).id : choice.id)
  // Основная тема — тем же правилом, что у резолвера: конфиг, который сборка
  // отвергнет, здесь не получает правдоподобного ответа.
  const main = entries.length > 0
    ? idOf(entries[defaultThemeIndex(entries)]!.theme)
    : owner?.theme.defaultTheme ?? (themes.length === 1 ? themes[0]!.id : null)
  return {
    owner: owner?.id ?? null,
    defaultTheme: owner?.theme.defaultTheme ?? null,
    main,
    built: entries.map(entry => idOf(entry.theme)).filter(id => id !== main),
    themes,
  }
}

/** Исход сверки пакета для печати: `@acme/ui ^1.2.0 ✓ 1.4.0`. */
export function formatTargetCheck(check: ThemeTargetCheck): string {
  switch (check.status) {
    case 'match': return `${check.providerId} ${check.range} ✓ ${check.version}`
    case 'mismatch': return `${check.providerId} ${check.range} ✗ ${check.version}`
    case 'absent': return `${check.providerId} ${check.range} (not in the graph)`
    case 'unknown-version': return `${check.providerId} ${check.range} (version unknown)`
  }
}

export function formatThemesReport(report: ThemesReport): string {
  const lines: string[] = ['granum themes', '=============', '']
  if (report.owner === null) {
    lines.push('No provider in the graph declares a theme catalog.')
    if (report.main !== null)
      lines.push(`The application theme object '${report.main}' is used as is.`)
    return lines.join('\n')
  }
  lines.push(`Catalog: ${report.owner} (${report.themes.length} theme(s), default: ${report.defaultTheme ?? '—'})`)
  lines.push('')
  for (const theme of report.themes) {
    const marks = [theme.id === report.main ? 'default' : '', report.built.includes(theme.id) ? 'built' : ''].filter(Boolean)
    lines.push(`  • ${theme.id} — ${theme.title}${theme.version ? ` ${theme.version}` : ''}${theme.extends ? ` (extends ${theme.extends})` : ''}${marks.length ? ` [${marks.join(', ')}]` : ''}`)
    if (theme.modes)
      lines.push(`      modes: ${theme.modes.join(', ')} (default: ${theme.defaultMode})`)
    if (theme.targets && theme.targets.length > 0)
      lines.push(`      targets: ${theme.targets.map(formatTargetCheck).join(', ')}`)
    if (theme.docs)
      lines.push(`      docs: ${theme.docs}`)
  }
  const own = [report.main, ...report.built].filter((id): id is string => id !== null && !report.themes.some(theme => theme.id === id))
  for (const id of own)
    lines.push('', `${id === report.main ? 'Default' : 'Built'}: '${id}' — an application theme object, not from the catalog.`)
  return lines.join('\n')
}
