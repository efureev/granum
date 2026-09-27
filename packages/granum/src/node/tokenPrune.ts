/**
 * План обрезки токенов (T-2, INV-TOK-2, INV-TOK-3). Корни — потребление,
 * известное из манифестов селекции (`consumes`, `dynamic`, `var()` в safelist),
 * `var()` в правилах инлайнимых файлов и CSS компонентов, ключи
 * `tokenOverrides`, исходники приложения и шаблоны `keep`. Замыкание — по
 * графу «токен → токены в его значении». Множество сохранённых глобально по
 * темам: токен, нужный только тёмной теме, обязан уцелеть и в светлой.
 */
import type { GranumPruneTokensOptions } from '../config'
import type { GranumResolution } from '../core/resolve'
import type { ThemeTokenOverrides } from '../core/tokenLayers'
import type { CssDeclarationOccurrence } from './cssDeclarations'
import type { InlinedCssSource } from './inlinedCss'
import { scanCssDeclarations } from './cssDeclarations'
import { extractTokenUses, unescapeCss } from './tokenScan'

export type TokenKeepReason
  = | { readonly kind: 'usage' }
    | { readonly kind: 'inlined-rule' }
    | { readonly kind: 'component-css' }
    | { readonly kind: 'override' }
    | { readonly kind: 'structural' }
    | { readonly kind: 'app-source' }
    | { readonly kind: 'keep-pattern', readonly pattern: string }
    | { readonly kind: 'referenced-by', readonly by: string }

export interface PrunableSection {
  readonly source: InlinedCssSource
  readonly css: string
}

export interface TokenPrunePlan {
  readonly isKept: (token: string) => boolean
  /** Токен (без `--`) → почему сохранён. */
  readonly kept: ReadonlyMap<string, TokenKeepReason>
  /** Объявленные в обрезаемых секциях токены, не попавшие в `kept`. */
  readonly removable: readonly string[]
  /** Шаблоны `keep`/`dynamic`, не совпавшие ни с одним объявленным токеном. */
  readonly deadPatterns: readonly string[]
}

function strip(token: string): string {
  return token.startsWith('--') ? token.slice(2) : token
}

/**
 * Матчер шаблона токена: точное имя, префикс с `*` или готовый RegExp.
 *
 * Префикс `--` снимается и у шаблона, и у проверяемого имени: в манифесте
 * токены лежат с ним (`--gr-z-modal`), а в `dynamicTokens` и `keep` их пишут и
 * так и так. Требовать одну форму значит ловить опечатку, которая ничего не
 * значит.
 *
 * Экспортируется, потому что тем же правилом обязана пользоваться диагностика:
 * токен, объявленный компонентом как читаемый в рантайме, для обрезки жив, а
 * для доктора до этого был «не объявлен никем» — одно и то же объявление
 * значило в двух местах разное.
 */
export function patternMatcher(pattern: string | RegExp): (token: string) => boolean {
  if (pattern instanceof RegExp)
    return token => pattern.test(token)
  const p = strip(pattern)
  if (p.endsWith('*')) {
    const prefix = p.slice(0, -1)
    return token => strip(token).startsWith(prefix)
  }
  return token => strip(token) === p
}

function overrideTokens(overrides: ThemeTokenOverrides | undefined): string[] {
  if (!overrides)
    return []
  const out: string[] = []
  for (const theme of Object.values(overrides)) {
    for (const [key, value] of Object.entries(theme ?? {})) {
      if (typeof value === 'string')
        out.push(key)
      else
        out.push(...Object.keys(value ?? {}))
    }
  }
  return out
}

function stripRanges(text: string, ranges: readonly CssDeclarationOccurrence[]): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const { start, end } of sorted) {
    if (start < cursor)
      continue
    out += text.slice(cursor, start)
    cursor = end
  }
  return out + text.slice(cursor)
}

export interface PlanTokenPruneInput {
  readonly resolution: GranumResolution
  readonly options: GranumPruneTokensOptions | undefined
  readonly tokenOverrides: ThemeTokenOverrides | undefined
  readonly inlined: readonly PrunableSection[]
  readonly componentCss: readonly string[]
  /** Потребление исходниками приложения, с `--`. */
  readonly appConsumes: readonly string[]
}

export function planTokenPrune(input: PlanTokenPruneInput): TokenPrunePlan {
  const kept = new Map<string, TokenKeepReason>()
  const keep = (token: string, reason: TokenKeepReason): void => {
    if (!kept.has(token))
      kept.set(token, reason)
  }

  // R1 — потребление выбранных компонентов из манифестов (и safelist).
  for (const { component } of input.resolution.selection.entries) {
    for (const token of component.consumesTokens)
      keep(strip(token), { kind: 'usage' })
    for (const klass of component.safelist) {
      for (const token of extractTokenUses(klass).keys())
        keep(token, { kind: 'usage' })
    }
  }

  // R2 — `var()` в правилах инлайнимых файлов (без их же объявлений) и в CSS компонентов.
  const declarationsBySection = new Map<PrunableSection, CssDeclarationOccurrence[]>()
  for (const section of input.inlined) {
    const decls = scanCssDeclarations(section.css)
    declarationsBySection.set(section, decls)
    const prunable = section.source.kind !== 'base'
    const rulesOnly = prunable ? stripRanges(section.css, decls) : section.css
    for (const token of extractTokenUses(unescapeCss(rulesOnly)).keys())
      keep(token, { kind: 'inlined-rule' })
  }
  for (const css of input.componentCss) {
    for (const token of extractTokenUses(unescapeCss(css)).keys())
      keep(token, { kind: 'component-css' })
  }

  // R3 — ключи tokenOverrides, сырые, до strictTokens.
  for (const token of overrideTokens(input.tokenOverrides))
    keep(token, { kind: 'override' })

  // R4 — шаблоны приложения и `dynamic` выбранных компонентов.
  const patterns: { label: string, match: (t: string) => boolean }[] = []
  for (const pattern of input.options?.keep ?? [])
    patterns.push({ label: String(pattern), match: patternMatcher(pattern) })
  for (const prefix of input.options?.keepPrefixes ?? [])
    patterns.push({ label: `${prefix}*`, match: patternMatcher(`${prefix}*`) })
  for (const { provider, component } of input.resolution.selection.entries) {
    for (const pattern of component.dynamicTokens)
      patterns.push({ label: `${provider.id}:${component.name} → ${pattern}`, match: patternMatcher(pattern) })
  }

  // R5 — исходники приложения.
  for (const token of input.appConsumes)
    keep(strip(token), { kind: 'app-source' })

  // R6 — структурные слои: значения из той же раскладки, что сериализует эмиссия.
  const values = new Map<string, string[]>()
  const addValue = (token: string, value: string): void => {
    const list = values.get(token)
    if (list)
      list.push(value)
    else
      values.set(token, [value])
  }
  for (const blocks of input.resolution.tokenLayers.values()) {
    for (const block of blocks) {
      for (const chain of block.tokens.values()) {
        if (chain.effective === undefined)
          continue
        keep(chain.token, { kind: 'structural' })
        addValue(chain.token, chain.effective)
      }
    }
  }

  const declaredInPrunable = new Set<string>()
  const allDeclared = new Set<string>()
  for (const [section, decls] of declarationsBySection) {
    const prunable = section.source.kind !== 'base'
    for (const decl of decls) {
      addValue(decl.token, decl.value)
      allDeclared.add(decl.token)
      if (prunable)
        declaredInPrunable.add(decl.token)
    }
  }

  const usedPatterns = new Set<string>()
  for (const token of new Set([...allDeclared, ...values.keys()])) {
    let reason: string | undefined
    for (const pattern of patterns) {
      if (!pattern.match(token))
        continue
      usedPatterns.add(pattern.label)
      reason ??= pattern.label
    }
    if (reason !== undefined)
      keep(token, { kind: 'keep-pattern', pattern: reason })
  }

  // Замыкание по значениям; цикл сходится по множеству.
  const queue = [...kept.keys()]
  while (queue.length > 0) {
    const token = queue.pop()!
    for (const value of values.get(token) ?? []) {
      for (const referenced of extractTokenUses(value).keys()) {
        if (!kept.has(referenced)) {
          kept.set(referenced, { kind: 'referenced-by', by: token })
          queue.push(referenced)
        }
      }
    }
  }

  return {
    isKept: token => kept.has(token),
    kept,
    removable: [...declaredInPrunable].filter(token => !kept.has(token)).sort(),
    deadPatterns: patterns.map(p => p.label).filter(label => !usedPatterns.has(label)),
  }
}
