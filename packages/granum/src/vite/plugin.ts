/**
 * Плагин приложения `granum()` — оркестратор конвейера (ТЗ §10). Одна
 * резолюция на билд (INV-RES-1) кормит три канала: CSS (`virtual:granum.css`
 * и срезы по слоям), JS (`virtual:granum/components` и guard импортов),
 * токены и темы (`virtual:granum/themes`). В dev правка исходников
 * приложения пересобирает только то, что от них зависит.
 */
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite'
import type { GranumConfig } from '../config'
import type { EmittedCss, LayerName } from '../node/emit'
import type { PreparedApp } from '../node/prepare'
import type { GranumThemeManifestOptions } from '../node/themeManifest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { ComponentOutsideSelectionError } from '../core/errors'
import { emitCss, LAYER_NAMES, layerOrderDeclaration, wrapLayer } from '../node/emit'
import { prepareApp } from '../node/prepare'
import { buildReport } from '../node/report'
import { getThemeManifest } from '../node/themeManifest'
import { validateGranumConfig } from './validateConfig'

export const VIRTUAL_CSS = 'virtual:granum.css'
export const VIRTUAL_LAYER_PREFIX = 'virtual:granum/layers/'
export const VIRTUAL_COMPONENTS = 'virtual:granum/components'
export const VIRTUAL_THEMES = 'virtual:granum/themes'

const RESOLVED_CSS = `\0${VIRTUAL_CSS}`
const RESOLVED_LAYER_PREFIX = `\0${VIRTUAL_LAYER_PREFIX}`
const RESOLVED_COMPONENTS = `\0${VIRTUAL_COMPONENTS}`
const RESOLVED_THEMES = `\0${VIRTUAL_THEMES}`

export interface GranumPluginOptions {
  /** Опции манифеста тем для `virtual:granum/themes`. */
  readonly themeManifest?: GranumThemeManifestOptions
  readonly log?: (line: string) => void
}

/** Имя ассета слоя до присвоения хеша: по нему он потом находится в бандле. */
function assetNameOf(layer: LayerName): string {
  return `granum.${layer}.css`
}

export function granum(config: GranumConfig, options: GranumPluginOptions = {}): Plugin {
  validateGranumConfig(config)
  const log = options.log ?? ((line: string) => process.stdout.write(`[granum] ${line}\n`))

  let root = process.cwd()
  let outDir = 'dist'
  let base = '/'
  let isBuild = false
  let isSsrBuild = false
  let server: ViteDevServer | undefined
  let prepared: Promise<PreparedApp> | undefined
  let emitted: Promise<EmittedCss> | undefined
  /** CSS-ассеты последнего бандла — источник размеров слоёв в отчёте (A-19). */
  let bundleCss: string | undefined
  /** Слои, уехавшие отдельными ассетами при `css.split`, в порядке слоёв (A-21). */
  let splitLayers: LayerName[] = []
  /** Проставлены ли `<link>` на них: без HTML-точки входа этого не произойдёт. */
  let splitLinked = false
  /** Делим ли слои в этой сборке. */
  const splitting = (): boolean => config.css?.split === true && isBuild && !isSsrBuild

  /*
   * Время фаз granum, миллисекунды. Печатается в итоговой строке сборки и НЕ
   * попадает в отчёт: `granum-report.json` обязан быть побайтно стабильным
   * между сборками (INV-DET-2), а время стабильным не бывает.
   *
   * Фазы: `prepare` — манифесты, пересчёт классов, скан исходников и резолюция;
   * `emit` — генератор утилит и сборка слоёв; `report` — размеры слоёв со
   * сжатием и запись файла. Всё остальное в сборке (vue, rolldown) — не granum.
   */
  const timings = { prepare: 0, emit: 0, report: 0 }

  const prepare = (): Promise<PreparedApp> => {
    if (prepared === undefined) {
      const started = performance.now()
      prepared = prepareApp(config, root).then((app) => {
        timings.prepare = performance.now() - started
        return app
      })
    }
    return prepared
  }
  const emit = (): Promise<EmittedCss> => {
    // Часы запускаются ВНУТРИ `then`: иначе в `emit` попало бы и время
    // подготовки, от которой эмиссия зависит.
    emitted ??= prepare().then(async (app) => {
      const started = performance.now()
      const css = await emitCss(app)
      timings.emit = performance.now() - started
      return css
    })
    return emitted
  }
  const invalidate = (): void => {
    prepared = undefined
    emitted = undefined
    timings.prepare = 0
    timings.emit = 0
    timings.report = 0
    bundleCss = undefined
    splitLayers = []
    splitLinked = false
    if (!server)
      return
    for (const id of [RESOLVED_CSS, RESOLVED_COMPONENTS, RESOLVED_THEMES, ...LAYER_NAMES.map(n => `${RESOLVED_LAYER_PREFIX}${n}.css`)]) {
      const mod = server.moduleGraph.getModuleById(id)
      if (mod)
        void server.reloadModule(mod)
    }
  }

  const providerKeyOf = (app: PreparedApp, source: string): string | undefined => {
    const m = /^(@[^/]+\/[^/]+|[^./@][^/]*)\/components\/([^/?#]+)$/.exec(source)
    if (!m)
      return undefined
    const [, pkg, name] = m
    const provider = app.resolution.registry.providers.get(pkg!)
    if (!provider || !provider.components.some(c => c.name === name))
      return undefined
    return `${pkg}:${name}`
  }

  return {
    name: 'granum:app',
    // `pre`: иначе `vite:resolve` разрешит `<pkg>/components/<Name>` раньше нас,
    // и guard импортов (A-6) не увидит ни одного спецификатора.
    enforce: 'pre',

    configResolved(resolved: ResolvedConfig): void {
      root = resolved.root
      outDir = resolved.build.outDir
      base = resolved.base
      isBuild = resolved.command === 'build'
      // Серверная сборка HTML не порождает, ссылки проставлять некуда: слои там
      // не делятся, CSS приезжает одним модулем, как и раньше.
      isSsrBuild = Boolean(resolved.build.ssr)
    },

    configureServer(devServer: ViteDevServer): void {
      server = devServer
      const dirs = (config.appSources?.dirs ?? []).map(d => resolve(root, d))
      const onChange = (file: string): void => {
        if (dirs.some(dir => file.startsWith(`${dir}/`) || file.startsWith(`${dir}\\`)))
          invalidate()
        else if (file.endsWith('granum.manifest.json'))
          invalidate()
      }
      devServer.watcher.on('change', onChange)
      devServer.watcher.on('add', onChange)
      devServer.watcher.on('unlink', onChange)
    },

    async buildStart(): Promise<void> {
      const app = await prepare()
      for (const w of app.warnings) {
        if (w.kind === 'provider-without-manifest')
          log(`warning: provider '${w.providerId}' is passed as an object and its baseUrl is not on disk; its classes and tokens are not known (build it with granumProvider() to get a manifest)`)
        else if (w.kind === 'provider-scanned')
          log(`provider '${w.providerId}' has no manifest: classes and tokens scanned from its dist (slow path)`)
        else if (w.kind === 'imports-without-app-sources')
          log(`warning: components: 'imports' needs appSources.dirs — the selection is empty`)
      }
    },

    async resolveId(source, importer) {
      if (source === VIRTUAL_CSS)
        return RESOLVED_CSS
      if (source.startsWith(VIRTUAL_LAYER_PREFIX))
        return `\0${source}`
      if (source === VIRTUAL_COMPONENTS)
        return RESOLVED_COMPONENTS
      if (source === VIRTUAL_THEMES)
        return RESOLVED_THEMES

      const guard = config.js?.guard ?? 'error'
      if (guard === 'off' || !importer || importer.startsWith('\0') || importer.includes('/node_modules/'))
        return null
      const app = await prepare()
      const key = providerKeyOf(app, source)
      if (key === undefined || app.resolution.selection.order.includes(key as never))
        return null
      const error = new ComponentOutsideSelectionError(key, relative(root, importer), app.resolution.selection.order)
      if (guard === 'error')
        throw error
      log(`warning: ${error.message}`)
      return null
    },

    async load(id) {
      if (id === RESOLVED_CSS) {
        /*
         * При `split` содержимое уезжает отдельными ассетами, и здесь остаётся
         * ровно объявление порядка слоёв. Оно обязано быть первым (INV-CSS-1), и
         * ссылку на этот ассет Vite ставит раньше наших — значит место верное.
         * Дублировать его в ассете первого слоя не надо: объявление одно.
         */
        return splitting() ? layerOrderDeclaration(config.css ?? {}) : (await emit()).css
      }
      if (id.startsWith(RESOLVED_LAYER_PREFIX)) {
        const name = id.slice(RESOLVED_LAYER_PREFIX.length).replace(/\.css$/, '') as LayerName
        if (!LAYER_NAMES.includes(name))
          throw new Error(`granum: unknown layer '${name}' (expected one of ${LAYER_NAMES.join(', ')})`)
        return wrapLayer((await emit()).layers, name, config.css ?? {})
      }
      if (id === RESOLVED_COMPONENTS) {
        const app = await prepare()
        const lines: string[] = []
        for (const { provider, component } of app.resolution.selection.entries) {
          if (provider.form !== 'manifest')
            continue
          lines.push(`export { ${component.name} } from '${provider.id}/components/${component.name}'`)
        }
        return `${lines.join('\n')}\n`
      }
      if (id === RESOLVED_THEMES) {
        const app = await prepare()
        return `export default ${JSON.stringify(getThemeManifest(app.resolution, options.themeManifest ?? {}))}\n`
      }
      return null
    },

    /**
     * Ассеты слоёв (A-21).
     *
     * Эмитятся здесь, а не в `generateBundle`: имя с хешем присваивается
     * бандлером позже, и сослаться на него можно только через `getFileName` по
     * ссылке, выданной сейчас. Пустые слои пропускаются — ассета и запроса за
     * ним быть не должно.
     */
    async renderStart(): Promise<void> {
      if (!splitting())
        return
      const css = await emit()
      const options = config.css ?? {}
      splitLayers = []
      for (const layer of LAYER_NAMES) {
        const source = wrapLayer(css.layers, layer, options, { declareOrder: false })
        if (!source)
          continue
        this.emitFile({ type: 'asset', name: assetNameOf(layer), source })
        splitLayers.push(layer)
      }
    },

    /**
     * Порядок ссылок и есть порядок слоёв: первое появление слоя задаёт его
     * место в каскаде, поэтому `<link>` проставляются строго по `LAYER_NAMES`.
     */
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string, ctx: { bundle?: Record<string, unknown> }) {
        if (!splitting() || splitLayers.length === 0)
          return html
        // Имя с хешем присваивает бандлер, поэтому берём его из самого бандла по
        // имени, под которым ассет эмитился: ссылка по `ref` в этом хуке не
        // типизирована, а бандл — типизирован и уже собран.
        const byName = new Map<string, string>()
        for (const item of Object.values(ctx.bundle ?? {})) {
          const asset = item as { type?: string, name?: string, names?: readonly string[], fileName?: string }
          if (asset.type !== 'asset' || typeof asset.fileName !== 'string')
            continue
          for (const name of [asset.name, ...(asset.names ?? [])]) {
            if (typeof name === 'string')
              byName.set(name, asset.fileName)
          }
        }
        const links = splitLayers
          .map(layer => byName.get(assetNameOf(layer)))
          .filter((fileName): fileName is string => fileName !== undefined)
        if (links.length !== splitLayers.length)
          return html
        splitLinked = true
        // База обязательна: приложение может жить не в корне домена, и Vite
        // проставляет её своим ссылкам — наши не имеют права отличаться.
        const prefix = base.endsWith('/') ? base : `${base}/`
        return links.map(href => ({
          tag: 'link',
          attrs: { rel: 'stylesheet', href: `${prefix}${href}` },
          injectTo: 'head' as const,
        }))
      },
    },

    generateBundle(_options, bundle): void {
      const parts: string[] = []
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name]
        if (item && item.type === 'asset' && name.endsWith('.css') && typeof item.source === 'string')
          parts.push(item.source)
      }
      bundleCss = parts.join('\n')
    },

    async closeBundle(): Promise<void> {
      if (!isBuild)
        return
      const app = await prepare()
      const css = await emit()
      // Без HTML-точки входа ссылки проставить некуда, и CSS не приедет вовсе:
      // это тихая поломка, поэтому говорим о ней громко.
      if (splitting() && splitLayers.length > 0 && !splitLinked) {
        log(
          `warning: css.split is on, ${splitLayers.length} layer asset(s) were emitted, but no HTML entry was found to link them `
          + `— the CSS will not load. Drop css.split or add an HTML entry.`,
        )
      }
      const reportStarted = performance.now()
      const report = buildReport(app, css, bundleCss !== undefined ? { bundleCss } : {})
      const file = config.report?.file ?? 'granum-report.json'
      if (file !== false) {
        const target = join(resolve(root, outDir), file)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`)
      }
      timings.report = performance.now() - reportStarted
      log(
        `${report.selection.length} components, ${report.classes.matched} classes matched, `
        + `${report.classes.unmatched.length} without a rule, themes [${report.themes.names.join(', ')}]${
          report.prune ? `, prune: ${report.prune.removable.length} removable` : ''
        }${splitting() && splitLayers.length > 0 ? `, css: ${splitLayers.length} layer assets` : ''}${file !== false ? ` → ${join(outDir, file)}` : ''}`,
      )
      // Время — отдельной строкой: её читает человек, ища медленную фазу, и
      // скрипт замера стендов, которому негде больше взять эти числа (в отчёте их нет).
      const ms = (n: number): number => Math.round(n)
      log(`time ${ms(timings.prepare + timings.emit + timings.report)} ms (prepare ${ms(timings.prepare)}, emit ${ms(timings.emit)}, report ${ms(timings.report)})`)
    },
  }
}
