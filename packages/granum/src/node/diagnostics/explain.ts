/**
 * `granum explain <providerId:Component>`: почему компонент в сборке и что он
 * в неё приносит — по той же резолюции, из которой эмитится CSS.
 */
import type { ComponentKey, ComponentRegistry } from '../../core/registry'
import type { PreparedApp } from '../prepare'
import { resolveComponentTarget, splitComponentKey } from '../../core/registry'
import { normalizeDependency, normalizeSelection } from '../../core/resolveSelection'

export type ExplainReason = 'selected' | 'dependency' | 'not-selected' | 'unknown'

export interface ExplainTokenContribution {
  readonly theme: string
  readonly selector: string
  readonly tokens: readonly { readonly name: string, readonly value: string, readonly effective: string, readonly overridden: boolean }[]
}

export interface ExplainReport {
  readonly key: string
  readonly providerId: string
  readonly name: string
  readonly reason: ExplainReason
  readonly included: boolean
  /** Кратчайшая цепочка от корня селекции, включая сам компонент. */
  readonly chain: readonly string[]
  readonly dependencies: readonly string[]
  readonly requiredBy: readonly string[]
  readonly group?: string
  readonly classes: readonly string[]
  readonly safelist: readonly string[]
  readonly css: readonly string[]
  readonly files: readonly string[]
  readonly tokens: readonly ExplainTokenContribution[]
  readonly consumes: readonly string[]
  readonly available?: readonly string[]
}

function directDependencies(registry: ComponentRegistry, key: ComponentKey): ComponentKey[] {
  const entry = registry.components.get(key)
  if (!entry)
    return []
  return entry.component.dependencies.flatMap(dep => normalizeDependency(dep, entry.provider.id))
}

function shortestChain(registry: ComponentRegistry, seeds: readonly ComponentKey[], target: ComponentKey): ComponentKey[] {
  const previous = new Map<ComponentKey, ComponentKey | undefined>()
  const queue: ComponentKey[] = []
  for (const seed of seeds) {
    if (!previous.has(seed)) {
      previous.set(seed, undefined)
      queue.push(seed)
    }
  }
  let head = 0
  while (head < queue.length) {
    const key = queue[head++]!
    if (key === target)
      break
    for (const dep of directDependencies(registry, key)) {
      if (!previous.has(dep)) {
        previous.set(dep, key)
        queue.push(dep)
      }
    }
  }
  if (!previous.has(target))
    return []
  const chain: ComponentKey[] = []
  let cursor: ComponentKey | undefined = target
  while (cursor !== undefined) {
    chain.unshift(cursor)
    cursor = previous.get(cursor)
  }
  return chain
}

export function granumExplain(app: PreparedApp, target: string): ExplainReport {
  const { resolution } = app
  const registry = resolution.registry
  const empty = (key: string, providerId: string, name: string, available: readonly string[]): ExplainReport => ({
    key,
    providerId,
    name,
    reason: 'unknown',
    included: false,
    chain: [],
    dependencies: [],
    requiredBy: [],
    classes: [],
    safelist: [],
    css: [],
    files: [],
    tokens: [],
    consumes: [],
    available,
  })

  const resolved = resolveComponentTarget(target, registry)
  if ('ambiguous' in resolved)
    return empty(target, '', target, resolved.ambiguous.length ? resolved.ambiguous : [...registry.components.keys()])

  const key = resolved.key
  const [providerId, name] = splitComponentKey(key)
  const entry = registry.components.get(key)
  if (!entry) {
    return empty(key, providerId, name, registry.providers.has(providerId)
      ? registry.getComponentsOfProvider(providerId).map(c => `${providerId}:${c.name}`)
      : [...registry.components.keys()])
  }

  const { component, provider } = entry
  const included = resolution.selection.order.includes(key)
  const seeds = app.config.components === 'imports'
    ? normalizeSelection(app.appScan.componentImports, registry)
    : normalizeSelection(app.config.components, registry)
  const isSeed = seeds.includes(key)
  const chain = included && !isSeed ? shortestChain(registry, seeds, key) : (isSeed ? [key] : [])
  const requiredBy = resolution.selection.order.filter(other => other !== key && directDependencies(registry, other).includes(key))

  const tokens: ExplainTokenContribution[] = []
  for (const item of resolution.themes.items) {
    if (item.componentName !== name || item.providerId !== providerId || !item.tokenDefinition)
      continue
    const selector = item.tokenDefinition.selector ?? resolution.themes.tokenRegistry[item.themeName]?.blocks[0]?.selector ?? ':root'
    const block = resolution.tokenLayers.get(item.themeName)?.find(b => b.selector === selector)
    tokens.push({
      theme: item.themeName,
      selector,
      tokens: Object.entries(item.tokenDefinition.tokens).map(([tokenName, value]) => {
        const effective = block?.tokens.get(tokenName)?.effective ?? value
        return { name: tokenName, value, effective, overridden: effective !== value }
      }),
    })
  }

  const files = provider.form === 'manifest' && 'manifest' in provider.source
    ? provider.source.manifest.components[name]?.files ?? []
    : []

  return {
    key,
    providerId,
    name,
    reason: included ? (isSeed ? 'selected' : 'dependency') : 'not-selected',
    included,
    chain,
    dependencies: directDependencies(registry, key),
    requiredBy,
    ...(component.group ? { group: component.group } : {}),
    classes: component.classes,
    safelist: component.safelist,
    css: component.css,
    files,
    tokens,
    consumes: component.consumesTokens,
  }
}

const REASON_TEXT: Record<ExplainReason, string> = {
  'selected': 'listed in the selection',
  'dependency': 'pulled in as a dependency',
  'not-selected': 'declared by its provider but NOT part of the build',
  'unknown': 'no provider declares such a component',
}

export function formatExplainReport(report: ExplainReport): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)
  const title = `granum explain ${report.key}`
  push(title)
  push('='.repeat(title.length))
  push()
  push(`Status: ${report.included ? 'in the build' : 'NOT in the build'} — ${REASON_TEXT[report.reason]}`)
  if (report.reason === 'unknown') {
    push()
    push(`Known components (${report.available?.length ?? 0}):`)
    for (const key of report.available ?? [])
      push(`  • ${key}`)
    return lines.join('\n')
  }
  if (report.chain.length > 1) {
    push()
    push('Chain from the selection root:')
    push(`  ${report.chain.join(' → ')}`)
  }
  push()
  push(`Dependencies (${report.dependencies.length}): ${report.dependencies.join(', ') || '—'}`)
  push(`Required by (${report.requiredBy.length}): ${report.requiredBy.join(', ') || '—'}`)
  push()
  push('Contributes to the build:')
  push(`  classes (${report.classes.length}): ${report.classes.join(' ') || '—'}`)
  push(`  safelist (${report.safelist.length}): ${report.safelist.join(' ') || '—'}`)
  push(`  css (${report.css.length}): ${report.css.join(', ') || '—'}`)
  push(`  files (${report.files.length}): ${report.files.join(', ') || '—'}`)
  push(`  consumes tokens (${report.consumes.length}): ${report.consumes.join(' ') || '—'}`)
  push(`  tokens (${report.tokens.length} theme(s)):${report.tokens.length ? '' : ' —'}`)
  for (const c of report.tokens) {
    push(`    • [${c.theme}] ${c.selector}`)
    for (const t of c.tokens)
      push(`        --${t.name}: ${t.value}${t.overridden ? ` (overridden → ${t.effective})` : ''}`)
  }
  if (report.group)
    push(`  group: ${report.group}`)
  return lines.join('\n')
}
