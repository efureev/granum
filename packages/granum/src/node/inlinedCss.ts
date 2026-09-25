/**
 * Файлы, которые приложение инлайнит целиком, в порядке эмиссии (INV-CSS-2):
 * `tokens` → `base` → файлы тем. Чистая функция над резолюцией; единственный
 * источник правды о том, какой файл уедет в CSS — из неё читают и эмиссия,
 * и диагностика.
 */
import type { GranumResolution } from '../core/resolve'
import { resolveCssFilePath } from './css'

export type InlinedCssKind = 'tokens' | 'base' | 'theme'

export interface InlinedCssSource {
  /** Абсолютный путь файла (или data URL). */
  readonly path: string
  readonly kind: InlinedCssKind
  readonly providerId: string
  /** Имя темы — только у файлов тем. */
  readonly theme?: string
}

/** Путь провайдера (относительно базы или URL) → абсолютный путь. */
export function resolveProviderPath(ref: string, baseUrl: string | undefined): string {
  if (/^[a-z]+:/i.test(ref) || ref.startsWith('/'))
    return resolveCssFilePath(ref)
  if (baseUrl === undefined)
    return resolveCssFilePath(ref)
  return resolveCssFilePath(new URL(ref, baseUrl).href)
}

export function resolveInlinedCssSources(resolution: GranumResolution): InlinedCssSource[] {
  const sources: InlinedCssSource[] = []
  const seen = new Set<string>()
  const add = (source: InlinedCssSource): void => {
    if (seen.has(source.path))
      return
    seen.add(source.path)
    sources.push(source)
  }

  for (const provider of resolution.providers) {
    if (provider.theme.tokensCss !== undefined)
      add({ path: resolveProviderPath(provider.theme.tokensCss, provider.baseUrl), kind: 'tokens', providerId: provider.id })
  }
  for (const provider of resolution.providers) {
    if (provider.theme.baseCss !== undefined)
      add({ path: resolveProviderPath(provider.theme.baseCss, provider.baseUrl), kind: 'base', providerId: provider.id })
  }

  // Файлы тем — по `items`: структурные темы физически не несут `cssRef`,
  // и читать `theme.themes[name]` напрямую значило бы инлайнить файл, который
  // в CSS не уедет (INV-THM-4).
  const byId = new Map(resolution.providers.map(p => [p.id, p]))
  for (const item of resolution.themes.items) {
    if (!item.cssRef)
      continue
    const provider = byId.get(item.providerId)
    add({ path: resolveProviderPath(item.cssRef, provider?.baseUrl), kind: 'theme', providerId: item.providerId, theme: item.themeName })
  }

  return sources
}
