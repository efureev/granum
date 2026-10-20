/**
 * `granum themes <config>`: каталог тем графа по индексу манифеста владельца —
 * id, название, родитель, режимы, ссылка на дизайн-систему (D-10). Данные тем
 * не читаются: индекс манифеста для того и записан.
 */
import type { GranumConfig } from '../../config'
import { toProviderNode } from '../../core/providerNode'
import { findThemeOwner, splitThemeKey } from '../../core/resolveThemes'
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
}

export interface ThemesReport {
  /** Владелец каталога; `null` — тем в графе нет. */
  readonly owner: string | null
  readonly defaultTheme: string | null
  /** Тема, которую выбирает конфиг: id из `theme` или `defaultTheme`; тема-объект — её id. */
  readonly active: string | null
  readonly previews: readonly string[]
  readonly themes: readonly ThemesCatalogEntry[]
}

export function granumThemes(config: GranumConfig, root: string): ThemesReport {
  const nodes = loadProviderInputs(config, root).map(toProviderNode)
  const owner = findThemeOwner(nodes)
  const themes = Object.entries(owner?.theme.catalog ?? {}).map(([id, entry]) => ({
    id,
    title: entry.title,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.docs !== undefined ? { docs: entry.docs } : {}),
    ...(entry.extends !== undefined ? { extends: entry.extends } : {}),
    ...(entry.modes !== undefined ? { modes: entry.modes } : {}),
    ...(entry.defaultMode !== undefined ? { defaultMode: entry.defaultMode } : {}),
  }))
  const idOf = (choice: GranumConfig['theme']): string | null => {
    if (choice === undefined)
      return null
    return typeof choice === 'string' ? splitThemeKey(choice).id : choice.id
  }
  return {
    owner: owner?.id ?? null,
    defaultTheme: owner?.theme.defaultTheme ?? null,
    active: idOf(config.theme) ?? owner?.theme.defaultTheme ?? (themes.length === 1 ? themes[0]!.id : null),
    previews: (config.previews ?? []).map(choice => idOf(choice)!),
    themes,
  }
}

export function formatThemesReport(report: ThemesReport): string {
  const lines: string[] = ['granum themes', '=============', '']
  if (report.owner === null) {
    lines.push('No provider in the graph declares a theme catalog.')
    if (report.active !== null)
      lines.push(`The application theme object '${report.active}' is used as is.`)
    return lines.join('\n')
  }
  lines.push(`Catalog: ${report.owner} (${report.themes.length} theme(s), default: ${report.defaultTheme ?? '—'})`)
  lines.push('')
  for (const theme of report.themes) {
    const marks = [theme.id === report.active ? 'active' : '', report.previews.includes(theme.id) ? 'preview' : ''].filter(Boolean)
    lines.push(`  • ${theme.id} — ${theme.title}${theme.extends ? ` (extends ${theme.extends})` : ''}${marks.length ? ` [${marks.join(', ')}]` : ''}`)
    if (theme.modes)
      lines.push(`      modes: ${theme.modes.join(', ')} (default: ${theme.defaultMode})`)
    if (theme.docs)
      lines.push(`      docs: ${theme.docs}`)
  }
  if (report.active !== null && !report.themes.some(theme => theme.id === report.active))
    lines.push('', `Active: '${report.active}' — an application theme object, not from the catalog.`)
  return lines.join('\n')
}
