/**
 * Отчёт сборки приложения (A-19, A-20, INV-DIAG-1, INV-DIAG-2): считается
 * теми же функциями, что и эмиссия, поэтому не может назвать значение,
 * которого в сборке нет.
 */
import type { EmittedCss, LayerName } from './emit'
import type { PreparedApp } from './prepare'
import { Buffer } from 'node:buffer'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { sortedUnique } from '../core/dedupe'
import { GRANUM_VERSION } from '../version'
import { extractLayerBlocks } from './cssLayerBlocks'
import { LAYER_NAMES } from './emit'
import { resolveInlinedCssSources } from './inlinedCss'

export interface LayerSize {
  readonly raw: number
  readonly gzip: number
  readonly brotli: number
}

export interface GranumBuildReport {
  readonly generatedBy: string
  readonly selection: readonly { readonly key: string, readonly dependencies: readonly string[] }[]
  readonly themes: { readonly names: readonly string[], readonly namesSource: string }
  readonly classes: {
    readonly input: number
    readonly matched: number
    /** Класс → откуда он пришёл: ключи компонентов (`classes`/`safelist`) или `app`. */
    readonly unmatched: readonly { readonly className: string, readonly sources: readonly string[] }[]
    readonly safelistRedundant: readonly string[]
  }
  readonly tokens: {
    /** Потребляется селекцией или приложением, но не объявлен ни одним слоем (T-5). */
    readonly undefined: readonly string[]
  }
  readonly prune: { readonly mode: string, readonly removable: readonly string[], readonly deadPatterns: readonly string[], readonly kept: number } | null
  /**
   * Размеры слоёв. `bundle` — по блокам `@layer` в собранном CSS после
   * минификации (то, что уехало в дистрибутив); `emission` — по эмиссии
   * плагина до минификации (dev, `css.layers: false` или отчёт без бандла).
   */
  readonly sizesSource: 'bundle' | 'emission'
  readonly sizes: Readonly<Record<LayerName | 'total', LayerSize>>
  /** Размеры эмиссии до минификации — всегда; при `sizesSource: 'bundle'` отличаются от `sizes`. */
  readonly emissionSizes: Readonly<Record<LayerName | 'total', LayerSize>>
  readonly warnings: readonly string[]
}

export interface BuildReportOptions {
  /** CSS-ассеты бандла (конкатенация): источник размеров слоёв после минификации. */
  readonly bundleCss?: string
}

/** Размеры по блокам `@layer` бандла; `undefined`, если блоков granum там нет. */
export function bundleLayerSizes(bundleCss: string, prefix: string): Record<LayerName | 'total', LayerSize> | undefined {
  const { blocks, statements } = extractLayerBlocks(bundleCss, prefix)
  if (blocks.size === 0)
    return undefined
  const total = [...statements, ...LAYER_NAMES.map(name => blocks.get(name) ?? '')].join('')
  return Object.fromEntries([
    ...LAYER_NAMES.map(name => [name, sizeOf(blocks.get(name) ?? '')]),
    ['total', sizeOf(total)],
  ]) as Record<LayerName | 'total', LayerSize>
}

function sizeOf(text: string): LayerSize {
  return { raw: Buffer.byteLength(text), gzip: gzipSync(text).length, brotli: brotliCompressSync(text).length }
}

export function buildReport(app: PreparedApp, css: EmittedCss, options: BuildReportOptions = {}): GranumBuildReport {
  const { resolution } = app
  const sourcesOf = (className: string): string[] => {
    const out: string[] = []
    for (const { provider, component } of resolution.selection.entries) {
      if (component.classes.includes(className) || component.safelist.includes(className))
        out.push(`${provider.id}:${component.name}`)
    }
    if (app.appScan.classes.includes(className))
      out.push('app')
    return out
  }

  // Объявленные токены: манифесты (темы и компоненты) + структурные слои + инлайнимые файлы по манифесту `declares`.
  const declared = new Set<string>()
  for (const provider of resolution.providers) {
    for (const t of provider.theme.declares)
      declared.add(t)
    for (const set of Object.values(provider.theme.tokenDefinitions)) {
      for (const t of Object.keys(set.tokens))
        declared.add(`--${t}`)
    }
    for (const component of provider.components) {
      for (const set of Object.values(component.tokenDefinitions)) {
        for (const t of Object.keys(set.tokens))
          declared.add(`--${t}`)
      }
    }
  }
  for (const blocks of resolution.tokenLayers.values()) {
    for (const block of blocks) {
      for (const chain of block.tokens.values())
        declared.add(`--${chain.token}`)
    }
  }
  const consumed = new Set<string>()
  for (const { component } of resolution.selection.entries) {
    for (const t of component.consumesTokens)
      consumed.add(t)
  }
  for (const t of app.appScan.consumes)
    consumed.add(t)
  // Объектная форма провайдера не несёт `declares`: без манифестов вердикт неполон и не выносится.
  const hasManifests = resolution.providers.some(p => p.form === 'manifest') && resolveInlinedCssSources(resolution).length >= 0
  const tokenUndefined = hasManifests ? [...consumed].filter(t => !declared.has(t) && !t.startsWith('--un-')).sort() : []

  const emissionSizes = Object.fromEntries([
    ...LAYER_NAMES.map(name => [name, sizeOf(css.layers[name])]),
    ['total', sizeOf(css.css)],
  ]) as Record<LayerName | 'total', LayerSize>
  const fromBundle = options.bundleCss !== undefined && app.config.css?.layers !== false
    ? bundleLayerSizes(options.bundleCss, app.config.css?.layerPrefix ?? 'granum')
    : undefined

  const warnings: string[] = []
  for (const w of app.warnings)
    warnings.push('providerId' in w ? `${w.kind}: ${w.providerId}` : w.kind)
  for (const w of resolution.warnings) {
    if (w.kind !== 'provider-without-manifest')
      warnings.push(JSON.stringify(w))
  }

  return {
    generatedBy: `@feugene/granum@${GRANUM_VERSION}`,
    selection: resolution.selection.entries.map(({ provider, component }) => ({
      key: `${provider.id}:${component.name}`,
      dependencies: sortedUnique(component.dependencies.map(d => (typeof d === 'string' ? (d.includes(':') ? d : `${provider.id}:${d}`) : d.components.map(n => `${d.provider}:${n}`).join(',')))),
    })),
    themes: { names: resolution.themes.names, namesSource: resolution.themes.namesSource },
    classes: {
      input: css.engineInput.length,
      matched: css.engine.matched.size,
      // Токены из исходников приложения без правила — норма (экстрактор берёт
      // всё подряд); вердикт выносится только классам с известным источником.
      unmatched: css.engine.unmatched
        .map(className => ({ className, sources: sourcesOf(className).filter(s => s !== 'app') }))
        .filter(entry => entry.sources.length > 0),
      safelistRedundant: css.safelistRedundant,
    },
    tokens: { undefined: tokenUndefined },
    prune: css.prune
      ? { mode: app.config.pruneTokens?.mode ?? 'off', removable: css.prune.removable, deadPatterns: css.prune.deadPatterns, kept: css.prune.kept.size }
      : null,
    sizesSource: fromBundle ? 'bundle' : 'emission',
    sizes: fromBundle ?? emissionSizes,
    emissionSizes,
    warnings,
  }
}
