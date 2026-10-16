import type { ProviderClassSource, ReextractReason } from './dialects'
/**
 * Отчёт сборки приложения: считается
 * теми же функциями, что и эмиссия, поэтому не может назвать значение,
 * которого в сборке нет.
 */
import type { EmittedCss, LayerName } from './emit'
import type { PreparedApp } from './prepare'
import { Buffer } from 'node:buffer'
import { relative } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { sortedUnique } from '../core/dedupe'
import { GRANUM_VERSION } from '../version'
import { extractLayerBlocks } from './cssLayerBlocks'
import { declaredCssClasses } from './diagnostics/auditDist'
import { LAYER_NAMES } from './emit'
import { findUndefinedTokens } from './undefinedTokens'

export interface LayerSize {
  readonly raw: number
  readonly gzip: number
  /** Только при `report.brotli: true`: сжатие качества 11 стоит десятки миллисекунд на слой. */
  readonly brotli?: number
}

export interface GranumBuildReport {
  readonly generatedBy: string
  /** Движок приложения: реализация, словарь и его отпечаток. */
  readonly engine: {
    readonly name: string
    readonly version?: string
    readonly dialect: string
    readonly vocabulary: string
  }
  /** По провайдеру: чем собран, откуда взяты классы и что дал пересчёт. */
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
     * Классы разметки приложения, которые есть и у компонентов пакетов.
     *
     * Нужны аудиту дистрибутива: без них класс из разметки приложения,
     * совпавший с классом невыбранного компонента, выглядел бы утечкой
     * компонента. Всё, чего у пакетов нет, аудиту не пригодилось бы, а
     * отчёт раздувало: на витрине дизайн-системы полный список — 33 тысячи
     * имён и 750 kB JSON на каждую сборку.
     */
    readonly app: readonly string[]
  }
  readonly tokens: {
    /** Потребляется селекцией или приложением, но не объявлен ни одним слоем. */
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
 * редко.
 */
function sizeOf(text: string, brotli: boolean): LayerSize {
  return {
    raw: Buffer.byteLength(text),
    gzip: gzipSync(text).length,
    ...(brotli ? { brotli: brotliCompressSync(text).length } : {}),
  }
}

/**
 * Классы без правила с известным источником. Слово из исходников приложения
 * само по себе не класс — экстрактор берёт всё подряд, — и не судится. Класс
 * из атрибута разметки судится, если его нет ни у движка, ни в CSS собранного
 * бандла (утилиты, CSS провайдеров, свой CSS приложения, стили SFC), ни в
 * `.css`-файлах `appSources` (лист, подключённый строкой, ассетом не становится);
 * без CSS бандла собственный CSS приложения не виден, и вердикта нет
 * (`declared` не задан).
 */
function unmatchedClasses(
  app: PreparedApp,
  css: EmittedCss,
  sourcesOf: (className: string) => string[],
  declared: ReadonlySet<string> | undefined,
): { className: string, sources: string[] }[] {
  const out = new Map<string, string[]>()
  for (const className of css.engine.unmatched) {
    const known = sourcesOf(className).filter(source => source !== 'app')
    if (known.length > 0)
      out.set(className, known)
  }
  if (declared !== undefined) {
    for (const [className, files] of Object.entries(app.appScan.classAttributes)) {
      if (css.engine.matched.has(className) || declared.has(className))
        continue
      const sources = files.map(file => relative(app.root, file).replace(/\\/g, '/'))
      out.set(className, sortedUnique([...(out.get(className) ?? []), ...sources]))
    }
  }
  return [...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([className, sources]) => ({ className, sources }))
}

export function buildReport(app: PreparedApp, css: EmittedCss, options: BuildReportOptions = {}): GranumBuildReport {
  return buildReportFromBundles(app, css, options.bundleCss === undefined ? [] : [options.bundleCss])
}

/**
 * Отчёт по CSS бандлов всех окружений сборки: хост вправе собрать несколько
 * окружений одним билдом. Классы, объявленные CSS, берутся со всех бандлов —
 * правило в CSS клиента остаётся правилом, в каком бы порядке ни собирались
 * окружения. Размеры слоёв — с одного бандла, первого в списке, где есть блоки
 * granum: сумма посчитала бы слои дважды, если хост кладёт копию CSS в два
 * окружения. Поэтому порядок списка — порядок предпочтения, и плагин ставит
 * клиентские окружения первыми. Пустой список — CSS бандла нет, вердикта по
 * разметке нет. Из `./node` не экспортируется: публичный вход — `buildReport`.
 */
export function buildReportFromBundles(app: PreparedApp, css: EmittedCss, bundles: readonly string[]): GranumBuildReport {
  const { resolution, engine } = app
  /*
   * Индекс «класс → кто его объявил» строится один раз.
   *
   * Поиск перебором стоил 785 мс на витрине дизайн-системы: у неё 32 тысячи
   * классов без правила (экстрактор берёт из исходников приложения всё подряд),
   * и на каждый шёл линейный проход по 116 компонентам и по 33 тысячам классов
   * разметки. Это была половина всего времени granum на сборке.
   */
  const sources = new Map<string, string[]>()
  const addSource = (className: string, source: string): void => {
    const existing = sources.get(className)
    if (existing === undefined)
      sources.set(className, [source])
    else if (!existing.includes(source))
      existing.push(source)
  }
  for (const { provider, component } of resolution.selection.entries) {
    for (const className of component.classes)
      addSource(className, `${provider.id}:${component.name}`)
    for (const className of component.safelist)
      addSource(className, `${provider.id}:${component.name}`)
  }
  // Класс, потерянный пересчётом, в списках компонентов уже не лежит — но
  // источник у него есть, и без него он выпал бы из `unmatched`.
  for (const decision of app.engineDecisions) {
    for (const className of decision.lost)
      addSource(className, decision.providerId)
  }
  const appClasses = new Set(app.appScan.classes)
  /*
   * Классы ВСЕХ компонентов графа, а не только выбранных: `classes.app` нужен
   * аудиту, чтобы не вменять невыбранному компоненту класс, который приехал из
   * разметки приложения. Фильтр по одной лишь селекции отбрасывал ровно те
   * имена, ради которых поле и заведено, — на стендах дизайн-системы это сразу
   * дало полторы сотни ложных находок.
   */
  const packageClasses = new Set<string>()
  for (const provider of resolution.providers) {
    for (const component of provider.components) {
      for (const className of component.classes)
        packageClasses.add(className)
      for (const className of component.safelist)
        packageClasses.add(className)
    }
  }
  const sourcesOf = (className: string): string[] => {
    const out = [...(sources.get(className) ?? [])]
    if (appClasses.has(className))
      out.push('app')
    return out
  }

  // Тот же вердикт, что у доктора, той же функцией: только то,
  // что требуют выбранные компоненты; разметка приложения — его собственное дело.
  const tokenUndefined = sortedUnique(findUndefinedTokens(resolution).map(u => u.token))

  // Считать ли brotli — решает конфиг приложения: по умолчанию нет.
  const brotli = app.config.report?.brotli === true
  const emissionSizes = Object.fromEntries([
    ...LAYER_NAMES.map(name => [name, sizeOf(css.layers[name], brotli)]),
    ['total', sizeOf(css.css, brotli)],
  ]) as Record<LayerName | 'total', LayerSize>
  let fromBundle: Record<LayerName | 'total', LayerSize> | undefined
  if (app.config.css?.layers !== false) {
    for (const bundle of bundles) {
      fromBundle = bundleLayerSizes(bundle, app.config.css?.layerPrefix ?? 'granum', brotli)
      if (fromBundle)
        break
    }
  }

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
      unmatched: unmatchedClasses(app, css, sourcesOf, bundles.length > 0 ? new Set([...declaredCssClasses(bundles.join('\n')), ...app.appScan.declaredClasses]) : undefined),
      safelistRedundant: css.safelistRedundant,
      app: [...appClasses].filter(className => packageClasses.has(className)).sort(),
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
