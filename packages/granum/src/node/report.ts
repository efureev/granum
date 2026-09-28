import type { ProviderClassSource, ReextractReason } from './dialects'
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
  /** Только при `report.brotli: true`: сжатие качества 11 стоит десятки миллисекунд на слой. */
  readonly brotli?: number
}

export interface GranumBuildReport {
  readonly generatedBy: string
  /** Движок приложения: реализация, словарь и его отпечаток (D-E1). */
  readonly engine: {
    readonly name: string
    readonly version?: string
    readonly dialect: string
    readonly vocabulary: string
  }
  /** По провайдеру: чем собран, откуда взяты классы и что дал пересчёт (D-E1). */
  readonly providers: readonly {
    readonly id: string
    readonly dialect: string | null
    readonly vocabulary: string | null
    readonly engineName: string | null
    readonly classes: ProviderClassSource
    readonly reason: ReextractReason
    readonly rulesLoaded: boolean
    readonly lost: readonly string[]
    readonly gained: readonly string[]
  }[]
  readonly selection: readonly { readonly key: string, readonly dependencies: readonly string[] }[]
  readonly themes: { readonly names: readonly string[], readonly namesSource: string }
  readonly classes: {
    readonly input: number
    readonly matched: number
    /** Класс → откуда он пришёл: ключи компонентов (`classes`/`safelist`) или `app`. */
    readonly unmatched: readonly { readonly className: string, readonly sources: readonly string[] }[]
    readonly safelistRedundant: readonly string[]
    /**
     * Классы, извлечённые из исходников приложения (`appSources`).
     *
     * Нужны аудиту дистрибутива: без них класс из разметки приложения,
     * совпавший с классом невыбранного компонента, выглядел бы утечкой
     * компонента (D-9).
     */
    readonly app: readonly string[]
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
export function bundleLayerSizes(bundleCss: string, prefix: string, brotli = false): Record<LayerName | 'total', LayerSize> | undefined {
  const { blocks, statements } = extractLayerBlocks(bundleCss, prefix)
  if (blocks.size === 0)
    return undefined
  const total = [...statements, ...LAYER_NAMES.map(name => blocks.get(name) ?? '')].join('')
  return Object.fromEntries([
    ...LAYER_NAMES.map(name => [name, sizeOf(blocks.get(name) ?? '', brotli)]),
    ['total', sizeOf(total, brotli)],
  ]) as Record<LayerName | 'total', LayerSize>
}

/**
 * Размер текста. `brotli` считается только по просьбе: качество 11 стоит 151 мс
 * на 222 kB против 2 мс у gzip, а слоёв шесть и меряются они дважды — эмиссия и
 * бандл. На сборке дизайн-системы это полсекунды за число, которое смотрят
 * редко (N-4).
 */
function sizeOf(text: string, brotli: boolean): LayerSize {
  return {
    raw: Buffer.byteLength(text),
    gzip: gzipSync(text).length,
    ...(brotli ? { brotli: brotliCompressSync(text).length } : {}),
  }
}

export function buildReport(app: PreparedApp, css: EmittedCss, options: BuildReportOptions = {}): GranumBuildReport {
  const { resolution, engine } = app
  const sourcesOf = (className: string): string[] => {
    const out: string[] = []
    for (const { provider, component } of resolution.selection.entries) {
      if (component.classes.includes(className) || component.safelist.includes(className))
        out.push(`${provider.id}:${component.name}`)
    }
    // Класс, потерянный пересчётом, в списках компонентов уже не лежит — но
    // источник у него есть, и без него он выпал бы из `unmatched` (A-E7).
    for (const decision of app.engineDecisions) {
      if (decision.lost.includes(className))
        out.push(decision.providerId)
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
  // Тот же вердикт, что у доктора: «нужен извне», а не «упомянут» (T-5).
  // Потребление с фолбэком и токен, который компонент присваивает сам, сюда не
  // попадают — иначе отчёт и доктор говорили бы разное об одном и том же.
  const consumed = new Set<string>()
  for (const { component } of resolution.selection.entries) {
    for (const t of component.requiresTokens)
      consumed.add(t)
  }
  for (const t of app.appScan.consumes)
    consumed.add(t)
  // Объектная форма провайдера не несёт `declares`: без манифестов вердикт неполон и не выносится.
  const hasManifests = resolution.providers.some(p => p.form === 'manifest') && resolveInlinedCssSources(resolution).length >= 0
  const tokenUndefined = hasManifests ? [...consumed].filter(t => !declared.has(t) && !t.startsWith('--un-')).sort() : []

  // Считать ли brotli — решает конфиг приложения: по умолчанию нет (N-4).
  const brotli = app.config.report?.brotli === true
  const emissionSizes = Object.fromEntries([
    ...LAYER_NAMES.map(name => [name, sizeOf(css.layers[name], brotli)]),
    ['total', sizeOf(css.css, brotli)],
  ]) as Record<LayerName | 'total', LayerSize>
  const fromBundle = options.bundleCss !== undefined && app.config.css?.layers !== false
    ? bundleLayerSizes(options.bundleCss, app.config.css?.layerPrefix ?? 'granum', brotli)
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
    engine: {
      name: engine.name,
      ...(engine.version !== undefined ? { version: engine.version } : {}),
      dialect: engine.dialect,
      vocabulary: engine.vocabulary,
    },
    providers: app.engineDecisions.map(d => ({
      id: d.providerId,
      dialect: d.dialect,
      vocabulary: d.vocabulary,
      engineName: d.engineName,
      classes: d.classes,
      reason: d.reason,
      rulesLoaded: d.rulesLoaded,
      lost: d.lost,
      gained: d.gained,
    })),
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
      app: [...app.appScan.classes].sort(),
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
