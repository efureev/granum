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
 * приложения их нет.
 */
import type { ComponentNode } from '../core/providerNode'
import type { ComponentKey } from '../core/registry'
import type { GranumResolution } from '../core/resolve'
import { sortedUnique } from '../core/dedupe'
import { allTokenChains } from '../core/tokenLayers'
import { readCssSync } from './css'
import { scanCssDeclarations } from './cssDeclarations'
import { resolveInlinedCssSources } from './inlinedCss'
import { patternMatcher } from './tokenPrune'

export interface UndefinedToken {
  readonly token: string
  readonly component: ComponentKey
}

/**
 * Токены, которые объявляют инлайнимые файлы провайдеров (`tokensCss` и
 * прочие), с `--` — и чей файл объявил первым. `theme.declares` манифеста
 * сюда не годится: в нём токены всех тем каталога, а не только активной.
 */
export function inlinedTokenDeclarations(resolution: GranumResolution): Map<string, string> {
  const declared = new Map<string, string>()
  for (const source of resolveInlinedCssSources(resolution)) {
    let css: string
    try {
      css = readCssSync(source.path)
    }
    catch {
      // Отсутствующий файл — находка `missing-file` доктора, а не повод молчать о токенах.
      continue
    }
    for (const decl of scanCssDeclarations(css)) {
      if (!declared.has(`--${decl.token}`))
        declared.set(`--${decl.token}`, source.providerId)
    }
  }
  return declared
}

/**
 * Что объявлено, считается один раз на прогон: инлайнимые файлы читаются с
 * диска, а судят по ним три вердикта — `token-undefined`, `token-fallback-only`
 * и полнота тем.
 */
export interface TokenDeclarations {
  /** Объявленные инлайнимыми файлами провайдеров, с `--`, — и чей файл объявил первым. */
  readonly inlined: Map<string, string>
  /** Со значением хоть в одной теме сборки — в корне, режиме или фолбэке; без `--`. */
  readonly themes: Set<string>
}

export function tokenDeclarations(resolution: GranumResolution): TokenDeclarations {
  const themes = new Set<string>()
  for (const set of resolution.tokens.themes) {
    for (const chain of allTokenChains(set)) {
      if (chain.effective !== undefined)
        themes.add(chain.token)
    }
  }
  return { inlined: inlinedTokenDeclarations(resolution), themes }
}

/** Токены, которые объявляет хоть один слой granum хоть в одной теме сборки, с `--`. */
function definedTokens(declarations: TokenDeclarations): Set<string> {
  const defined = new Set<string>(declarations.inlined.keys())
  for (const token of declarations.themes)
    defined.add(`--${token}`)
  return defined
}

/** Токены, которые компонент требует извне, с `--`: `requires` минус `dynamicTokens` и переменные движка. */
export function componentRequirements(component: ComponentNode): string[] {
  const dynamic = component.dynamicTokens.map(patternMatcher)
  return [...new Set(component.requiresTokens)].sort().filter(token => !token.startsWith('--un-') && !dynamic.some(match => match(token)))
}

export function findUndefinedTokens(resolution: GranumResolution, declarations: TokenDeclarations = tokenDeclarations(resolution)): UndefinedToken[] {
  const defined = definedTokens(declarations)
  const out: UndefinedToken[] = []
  for (const { provider, component } of resolution.selection.entries) {
    for (const token of componentRequirements(component)) {
      if (!defined.has(token))
        out.push({ token, component: `${provider.id}:${component.name}` as ComponentKey })
    }
  }
  return out
}

export interface FallbackOnlyTokens {
  readonly component: ComponentKey
  readonly tokens: readonly string[]
}

/**
 * Вердикт `token-fallback-only`: токен компонент читает только через
 * `var(--x, запасное)`, и ни один слой его не объявляет — компонент всегда
 * рисует запасное значение. Переименованный или забытый токен так не виден ни
 * глазу, ни `token-undefined`. Хук (`hookTokens`) — объявление автора, что это
 * норма; `dynamicTokens` и переменные движка вычитаются, как у `token-undefined`.
 */
export function findFallbackOnlyTokens(resolution: GranumResolution, declarations: TokenDeclarations = tokenDeclarations(resolution)): FallbackOnlyTokens[] {
  const defined = definedTokens(declarations)
  const out: FallbackOnlyTokens[] = []
  for (const { provider, component } of resolution.selection.entries) {
    const declared = [...component.hookTokens, ...component.dynamicTokens].map(patternMatcher)
    const tokens = sortedUnique(component.optionalTokens).filter(token => !defined.has(token) && !token.startsWith('--un-') && !declared.some(match => match(token)))
    if (tokens.length > 0)
      out.push({ component: `${provider.id}:${component.name}` as ComponentKey, tokens })
  }
  return out
}
