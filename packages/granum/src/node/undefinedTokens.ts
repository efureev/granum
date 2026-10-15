/**
 * Вердикт `token-undefined` (T-5, INV-DIAG-4): одна функция для доктора и
 * отчёта сборки — иначе об одном и том же они говорили бы разное.
 *
 * «Нужен извне» — `tokens.requires` выбранных компонентов: потребление без
 * fallback минус то, что компонент присваивает сам; считается на сборке пакета
 * и лежит в манифесте. Здесь из него вычитаются ещё `dynamicTokens` (имя
 * собирается в рантайме, компонент объявил это сам) и переменные движка
 * (`--un-*`). Разметка самого приложения в вердикт не входит: её токены — дело
 * приложения, и чаще всего их объявляет его же CSS.
 *
 * «Объявлено» — любым слоем granum: структурные цепочки со значением,
 * `declares` и `tokenDefinitions` провайдеров и компонентов, объявления в
 * инлайнимых файлах (у объектного провайдера `declares` пуст).
 */
import type { ComponentKey } from '../core/registry'
import type { GranumResolution } from '../core/resolve'
import { readCssSync } from './css'
import { scanCssDeclarations } from './cssDeclarations'
import { resolveInlinedCssSources } from './inlinedCss'
import { patternMatcher } from './tokenPrune'

export interface UndefinedToken {
  readonly token: string
  readonly component: ComponentKey
}

export function findUndefinedTokens(resolution: GranumResolution): UndefinedToken[] {
  const defined = new Set<string>()
  for (const blocks of resolution.tokenLayers.values()) {
    for (const block of blocks) {
      for (const chain of block.tokens.values()) {
        if (chain.effective !== undefined)
          defined.add(`--${chain.token}`)
      }
    }
  }
  for (const source of resolveInlinedCssSources(resolution)) {
    let css: string
    try {
      css = readCssSync(source.path)
    }
    catch {
      // Отсутствующий файл — находка `missing-file` доктора, а не повод молчать о токенах.
      continue
    }
    for (const decl of scanCssDeclarations(css))
      defined.add(`--${decl.token}`)
  }
  for (const provider of resolution.providers) {
    for (const token of provider.theme.declares)
      defined.add(token)
    for (const set of Object.values(provider.theme.tokenDefinitions)) {
      for (const token of Object.keys(set.tokens))
        defined.add(`--${token}`)
    }
    for (const component of provider.components) {
      for (const set of Object.values(component.tokenDefinitions)) {
        for (const token of Object.keys(set.tokens))
          defined.add(`--${token}`)
      }
    }
  }

  const out: UndefinedToken[] = []
  for (const { provider, component } of resolution.selection.entries) {
    const dynamic = component.dynamicTokens.map(patternMatcher)
    for (const token of [...new Set(component.requiresTokens)].sort()) {
      if (defined.has(token) || token.startsWith('--un-') || dynamic.some(match => match(token)))
        continue
      out.push({ token, component: `${provider.id}:${component.name}` as ComponentKey })
    }
  }
  return out
}
