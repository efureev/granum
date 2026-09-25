/**
 * `granum tokens <providerId:Component> [--deep]`: какие токены компонент
 * объявляет и потребляет, откуда берётся значение — слой за слоем.
 */
import type { ComponentKey } from '../../core/registry'
import type { TokenLayerValue } from '../../core/tokenLayers'
import type { PreparedApp } from '../prepare'
import { resolveComponentTarget, splitComponentKey } from '../../core/registry'
import { collectDependencyClosure } from '../../core/resolveSelection'

export type TokenOrigin = 'own' | 'component' | 'provider' | 'app' | 'none'

export interface TokensValueChain {
  readonly theme: string
  readonly selector: string
  readonly layers: readonly TokenLayerValue[]
  readonly effective?: string
}

export interface TokensUsage {
  /** Без `--`. */
  readonly token: string
  readonly origin: TokenOrigin
  readonly declaredBy?: string
  readonly usedBy: readonly string[]
  readonly alsoUsedBy: readonly string[]
  readonly dynamic: boolean
  readonly values: readonly TokensValueChain[]
}

export interface TokensDeclaration {
  readonly token: string
  readonly theme: string
  readonly selector: string
  readonly declaredBy: string
  readonly value: string
  readonly layers: readonly TokenLayerValue[]
  readonly effective?: string
  readonly overridden: boolean
  readonly unusedInScope: boolean
}

export interface TokensReport {
  readonly key: string
  readonly scope: 'own' | 'deep'
  readonly components: readonly string[]
  readonly included: boolean
  readonly declares: readonly TokensDeclaration[]
  readonly uses: readonly TokensUsage[]
  readonly undefinedCount: number
  readonly available?: readonly string[]
  readonly unresolved?: 'ambiguous' | 'unknown'
}

function originOf(layer: TokenLayerValue, targetKey: string): { origin: TokenOrigin, declaredBy: string } {
  if (layer.source === 'app-theme' || layer.source === 'app-override')
    return { origin: 'app', declaredBy: layer.source }
  if (layer.componentKey !== undefined)
    return { origin: layer.componentKey === targetKey ? 'own' : 'component', declaredBy: layer.componentKey }
  return { origin: 'provider', declaredBy: layer.source }
}

export function granumTokens(app: PreparedApp, target: string, scope: 'own' | 'deep' = 'own'): TokensReport {
  const { resolution } = app
  const registry = resolution.registry
  const resolved = resolveComponentTarget(target, registry)
  if ('ambiguous' in resolved) {
    return { key: target, scope, components: [], included: false, declares: [], uses: [], undefinedCount: 0, available: resolved.ambiguous.length ? resolved.ambiguous : [...registry.components.keys()], unresolved: resolved.ambiguous.length ? 'ambiguous' : 'unknown' }
  }
  const key = resolved.key
  const entry = registry.components.get(key)
  if (!entry) {
    const [providerId] = splitComponentKey(key)
    return { key, scope, components: [], included: false, declares: [], uses: [], undefinedCount: 0, available: registry.providers.has(providerId) ? registry.getComponentsOfProvider(providerId).map(c => `${providerId}:${c.name}`) : [...registry.components.keys()], unresolved: 'unknown' }
  }

  const scopeKeys: ComponentKey[] = scope === 'deep' ? [...collectDependencyClosure(registry, key)] : [key]
  const scopeSet = new Set<string>(scopeKeys)
  const included = resolution.selection.order.includes(key)

  // Чей токен: по слоям структурных значений; иначе — по `declares` манифестов.
  const declaredByProvider = new Map<string, string>()
  for (const provider of resolution.providers) {
    for (const t of provider.theme.declares)
      declaredByProvider.set(t.replace(/^--/, ''), `provider:${provider.id}`)
  }
  const chainsOf = (token: string): TokensValueChain[] => {
    const out: TokensValueChain[] = []
    for (const [theme, blocks] of resolution.tokenLayers) {
      for (const block of blocks) {
        const chain = block.tokens.get(token)
        if (chain)
          out.push({ theme, selector: block.selector, layers: chain.layers, ...(chain.effective !== undefined ? { effective: chain.effective } : {}) })
      }
    }
    return out
  }

  const consumers = (token: string): string[] => resolution.selection.entries
    .filter(e => e.component.consumesTokens.includes(`--${token}`) || e.component.dynamicTokens.some(d => d === `--${token}` || (d.endsWith('*') && `--${token}`.startsWith(d.slice(0, -1)))))
    .map(e => `${e.provider.id}:${e.component.name}`)

  const uses: TokensUsage[] = []
  const seen = new Set<string>()
  for (const k of scopeKeys) {
    const e = registry.components.get(k)
    if (!e)
      continue
    const names = [...e.component.consumesTokens.map(t => t.replace(/^--/, '')), ...e.component.dynamicTokens.map(t => t.replace(/^--/, ''))]
    for (const token of names) {
      if (seen.has(token))
        continue
      seen.add(token)
      const values = chainsOf(token)
      const first = values.find(v => v.layers.length > 0)?.layers[0]
      const dynamic = e.component.dynamicTokens.some(d => d.replace(/^--/, '') === token)
      let origin: TokenOrigin = 'none'
      let declaredBy: string | undefined
      if (first) {
        ({ origin, declaredBy } = originOf(first, key))
      }
      else if (declaredByProvider.has(token)) {
        origin = 'provider'
        declaredBy = declaredByProvider.get(token)
      }
      const usedBy = consumers(token)
      uses.push({
        token,
        origin,
        ...(declaredBy !== undefined ? { declaredBy } : {}),
        usedBy: usedBy.filter(c => scopeSet.has(c)),
        alsoUsedBy: usedBy.filter(c => !scopeSet.has(c)),
        dynamic,
        values,
      })
    }
  }

  const declares: TokensDeclaration[] = []
  for (const k of scopeKeys) {
    const e = registry.components.get(k)
    if (!e)
      continue
    for (const [theme, set] of Object.entries(e.component.tokenDefinitions)) {
      const selector = set.selector ?? resolution.themes.tokenRegistry[theme]?.blocks[0]?.selector ?? ':root'
      const block = resolution.tokenLayers.get(theme)?.find(b => b.selector === selector)
      for (const [token, value] of Object.entries(set.tokens)) {
        const chain = block?.tokens.get(token)
        const effective = chain?.effective
        declares.push({
          token,
          theme,
          selector,
          declaredBy: k,
          value,
          layers: chain?.layers ?? [],
          ...(effective !== undefined ? { effective } : {}),
          overridden: effective !== undefined && effective !== value,
          unusedInScope: consumers(token).length === 0,
        })
      }
    }
  }

  return {
    key,
    scope,
    components: scopeKeys,
    included,
    declares: declares.sort((a, b) => a.theme.localeCompare(b.theme, 'en') || a.token.localeCompare(b.token, 'en')),
    uses: uses.sort((a, b) => a.token.localeCompare(b.token, 'en')),
    undefinedCount: uses.filter(u => u.origin === 'none').length,
  }
}

export function formatTokensReport(report: TokensReport): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)
  const title = `granum tokens ${report.key}${report.scope === 'deep' ? ' --deep' : ''}`
  push(title)
  push('='.repeat(title.length))
  push()
  if (report.unresolved) {
    push(report.unresolved === 'ambiguous' ? 'The name is ambiguous — qualify it with the provider id:' : 'No provider declares such a component. Known:')
    for (const k of report.available ?? [])
      push(`  • ${k}`)
    return lines.join('\n')
  }
  push(`Scope: ${report.components.join(', ')} (${report.included ? 'in the build' : 'NOT in the build'})`)
  push()
  push(`Declares (${report.declares.length}):${report.declares.length ? '' : ' —'}`)
  for (const d of report.declares)
    push(`  • [${d.theme}] ${d.selector} --${d.token}: ${d.value}${d.overridden ? ` → ${d.effective} (overridden)` : ''}${d.unusedInScope ? ' (unused)' : ''}`)
  push()
  push(`Uses (${report.uses.length}, undefined: ${report.undefinedCount}):${report.uses.length ? '' : ' —'}`)
  for (const u of report.uses) {
    const where = u.origin === 'none' ? 'defined by no layer' : `${u.origin}${u.declaredBy ? ` (${u.declaredBy})` : ''}`
    push(`  • --${u.token}${u.dynamic ? ' (dynamic)' : ''} — ${where}${u.alsoUsedBy.length ? `; also used by ${u.alsoUsedBy.join(', ')}` : ''}`)
    for (const v of u.values)
      push(`      [${v.theme}] ${v.selector}: ${v.layers.map(l => `${l.source}=${l.value}${l.skipped ? ' (skipped)' : ''}`).join(' → ')}${v.effective !== undefined ? ` ⇒ ${v.effective}` : ''}`)
  }
  return lines.join('\n')
}
