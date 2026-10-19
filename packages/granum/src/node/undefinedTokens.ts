/**
 * Вердикт `token-undefined`: одна функция для доктора и
 * отчёта сборки — иначе об одном и том же они говорили бы разное.
 *
 * «Нужен извне» — `tokens.requires` выбранных компонентов: потребление без
 * fallback минус то, что компонент присваивает сам; считается на сборке пакета
 * и лежит в манифесте. Здесь из него вычитаются ещё `dynamicTokens` (имя
 * собирается в рантайме, компонент объявил это сам) и переменные движка
 * (`--un-*`). Разметка самого приложения в вердикт не входит: её токены — дело
 * приложения, и чаще всего их объявляет его же CSS.
 *
 * «Объявлено» — любым слоем granum в активной теме: значение хоть в одном
 * режиме или в `root` (данные темы, токены компонентов, значения приложения) и
 * объявления в инлайнимых файлах. Другие темы каталога сюда не входят: в CSS
 * приложения их нет (T-5, T-6).
 */
import type { ComponentKey } from '../core/registry'
import type { GranumResolution } from '../core/resolve'
import { allTokenChains } from '../core/tokenLayers'
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
  for (const chain of allTokenChains(resolution.tokens.active)) {
    if (chain.effective !== undefined)
      defined.add(`--${chain.token}`)
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
