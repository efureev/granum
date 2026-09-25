/**
 * Подготовка приложения к эмиссии (A-1…A-4, R-6): конфиг → провайдеры
 * (манифесты через `exports`, объекты — материализованные) → селекция
 * (список или `'imports'`) → одна резолюция → движок с правилами провайдеров.
 * Node-only. Всё ниже (CSS, JS, токены, отчёт) читает только `PreparedApp`.
 */
import type { GranumConfig } from '../config'
import type { GranumProviderInput } from '../contract'
import type { GranumResolution, GranumThemesInput } from '../core/resolve'
import type { ComponentSelection } from '../core/resolveSelection'
import type { GranumAppThemeDefinition } from '../core/resolveThemes'
import type { EngineInput, GranumEngine, GranumPreflight, GranumRule, GranumVariant } from '../engine/types'
import type { AppSourcesScan } from './appSources'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isLoadedManifest } from '../contract/manifest'
import { TokenRefError } from '../core/errors'
import { toProviderNode } from '../core/providerNode'
import { resolveGranum } from '../core/resolve'
import { APP_THEME_SOURCE } from '../core/resolveThemes'
import { createEngine } from '../engine/builtin'
import { scanAppSources } from './appSources'
import { tokenSetFromCssSync } from './cssTokens'
import { loadPackageManifest } from './manifest'
import { materializeProviderRefs } from './materializeRefs'
import { collectProviderInstances, scanObjectProvider } from './scanProvider'

export interface PreparedApp {
  readonly config: GranumConfig
  readonly root: string
  readonly resolution: GranumResolution
  readonly engine: GranumEngine
  readonly appScan: AppSourcesScan
  /** Правила/варианты/preflights провайдеров графа, с источниками (E-3). */
  readonly engineContribution: Pick<EngineInput, 'rules' | 'variants' | 'preflights' | 'sources'>
  readonly warnings: readonly PreparedWarning[]
}

export type PreparedWarning
  = | { readonly kind: 'provider-without-manifest', readonly providerId: string }
    /** Объектный провайдер просканирован по `dist` (R-6): классы и токены известны, но без графа бандлера. */
    | { readonly kind: 'provider-scanned', readonly providerId: string }
    | { readonly kind: 'imports-without-app-sources' }

interface EngineModuleShape {
  readonly rules?: readonly GranumRule[]
  readonly variants?: readonly GranumVariant[]
  readonly preflights?: readonly GranumPreflight[]
}

export function createConfiguredEngine(config: GranumConfig): GranumEngine {
  const engine = config.engine
  if (engine === undefined || engine === 'builtin')
    return createEngine()
  if (typeof (engine as GranumEngine).generate === 'function')
    return engine as GranumEngine
  return createEngine(engine as Parameters<typeof createEngine>[0])
}

/** Провайдер по имени пакета — манифест через `exports` (A-2); объект — как есть. */
export function loadProviderInputs(config: GranumConfig, root: string): GranumProviderInput[] {
  return config.providers.map((entry) => {
    if (typeof entry === 'string')
      return loadPackageManifest(entry, root)
    if (isLoadedManifest(entry))
      return entry
    return materializeProviderRefs(entry)
  })
}

/**
 * Медленный путь R-6: объектные провайдеры с раскладкой на диске заменяются
 * синтетическими манифестами; инстансы-доноры, которых нет во входе по id,
 * добавляются и сканируются тоже. Объекты без каталога остаются как есть.
 */
export async function scanProviderInputs(inputs: readonly GranumProviderInput[], engine: GranumEngine, warnings: PreparedWarning[]): Promise<{ resolver: GranumProviderInput[], engineSources: GranumProviderInput[] }> {
  const byId = new Set(inputs.map(i => (isLoadedManifest(i) ? i.manifest.id : i.id)))
  const engineSources = [...inputs]
  const queue = [...inputs]
  for (const input of inputs) {
    if (isLoadedManifest(input))
      continue
    for (const [id, donor] of collectProviderInstances(input)) {
      if (!byId.has(id)) {
        byId.add(id)
        queue.push(donor)
        engineSources.push(donor)
      }
    }
  }
  const resolver: GranumProviderInput[] = []
  for (const input of queue) {
    if (isLoadedManifest(input)) {
      resolver.push(input)
      continue
    }
    const scanned = await scanObjectProvider(input, engine)
    if (scanned) {
      warnings.push({ kind: 'provider-scanned', providerId: input.id })
      resolver.push(scanned)
    }
    else {
      resolver.push(input)
    }
  }
  return { resolver, engineSources }
}

async function loadEngineContribution(inputs: readonly GranumProviderInput[]): Promise<PreparedApp['engineContribution']> {
  const rules: GranumRule[] = []
  const variants: GranumVariant[] = []
  const preflights: GranumPreflight[] = []
  const sources = new Map<GranumRule | GranumVariant, string>()
  const tag = (id: string, shape: EngineModuleShape | undefined): void => {
    for (const rule of shape?.rules ?? []) {
      rules.push(rule)
      sources.set(rule, id)
    }
    for (const variant of shape?.variants ?? []) {
      variants.push(variant)
      sources.set(variant, id)
    }
    preflights.push(...(shape?.preflights ?? []))
  }
  for (const input of inputs) {
    if (isLoadedManifest(input)) {
      if (input.manifest.engineModule) {
        const mod = await import(new URL(input.manifest.engineModule, input.baseUrl).href) as { default?: EngineModuleShape }
        tag(input.manifest.id, mod.default ?? (mod as EngineModuleShape))
      }
      continue
    }
    tag(input.id, input.engine)
  }
  return { rules, variants, preflights, sources }
}

/**
 * `themes.define[*].tokensRef` → литеральные `tokens` (как у провайдеров):
 * относительный путь считается от корня приложения, `as` ссылки становится
 * селектором темы, если явный не задан; литеральные `tokens` важнее файла.
 */
export function materializeAppThemes(themes: GranumThemesInput | undefined, root: string): GranumThemesInput | undefined {
  if (!themes?.define)
    return themes
  let changed = false
  const define: Record<string, GranumAppThemeDefinition> = {}
  for (const [name, definition] of Object.entries(themes.define)) {
    if (!definition.tokensRef) {
      define[name] = definition
      continue
    }
    changed = true
    const ref = typeof definition.tokensRef === 'string' ? { url: definition.tokensRef } : definition.tokensRef
    const url = /^[a-z]+:/i.test(ref.url) ? ref.url : pathToFileURL(resolvePath(root, ref.url)).href
    let parsed
    try {
      parsed = tokenSetFromCssSync(url, {
        ...(ref.selector !== undefined ? { selector: ref.selector } : {}),
        ...(ref.as !== undefined ? { as: ref.as } : {}),
        ...(ref.strict !== undefined ? { strict: ref.strict } : {}),
      })
    }
    catch (cause) {
      throw new TokenRefError(APP_THEME_SOURCE, name, undefined, ref.url, { cause })
    }
    const { tokensRef: _dropped, ...rest } = definition
    define[name] = {
      ...rest,
      tokens: { ...parsed.tokens, ...definition.tokens },
      ...(definition.selector === undefined && ref.as !== undefined ? { selector: ref.as } : {}),
    }
  }
  return changed ? { ...themes, define } : themes
}

/**
 * Теги разметки → ключи селекции (A-8): имя берётся, если ровно один
 * провайдер графа его объявляет; неоднозначное или чужое имя пропускается.
 */
export function tagSelection(tags: readonly string[], inputs: readonly GranumProviderInput[]): string[] {
  if (tags.length === 0)
    return []
  const owners = new Map<string, string[]>()
  for (const input of inputs) {
    const node = toProviderNode(input)
    for (const component of node.components)
      owners.set(component.name, [...(owners.get(component.name) ?? []), node.id])
  }
  const out: string[] = []
  for (const tag of tags) {
    const providers = owners.get(tag)
    if (providers?.length === 1)
      out.push(`${providers[0]}:${tag}`)
  }
  return out
}

export async function prepareApp(config: GranumConfig, root: string): Promise<PreparedApp> {
  const engine = createConfiguredEngine(config)
  const loaded = loadProviderInputs(config, root)
  const appScan = scanAppSources(config.appSources, root, engine)
  const warnings: PreparedWarning[] = []
  const { resolver: inputs, engineSources } = await scanProviderInputs(loaded, engine, warnings)

  let components: ComponentSelection | undefined
  if (config.components === 'imports') {
    if (!config.appSources)
      warnings.push({ kind: 'imports-without-app-sources' })
    components = [...appScan.componentImports, ...tagSelection(appScan.componentTags, inputs)]
  }
  else {
    components = config.components
  }

  const themes = materializeAppThemes(config.themes, root)
  const resolution = resolveGranum({
    providers: inputs,
    ...(components !== undefined ? { components } : {}),
    ...(themes ? { themes } : {}),
  })
  for (const w of resolution.warnings) {
    if (w.kind === 'provider-without-manifest')
      warnings.push(w)
  }

  return {
    config,
    root,
    resolution,
    engine,
    appScan,
    engineContribution: await loadEngineContribution(engineSources),
    warnings,
  }
}
