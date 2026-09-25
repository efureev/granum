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
import process from 'node:process'
import { ComponentOutsideSelectionError } from '../core/errors'
import { emitCss, LAYER_NAMES } from '../node/emit'
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

export function granum(config: GranumConfig, options: GranumPluginOptions = {}): Plugin {
  validateGranumConfig(config)
  const log = options.log ?? ((line: string) => process.stdout.write(`[granum] ${line}\n`))

  let root = process.cwd()
  let outDir = 'dist'
  let isBuild = false
  let server: ViteDevServer | undefined
  let prepared: Promise<PreparedApp> | undefined
  let emitted: Promise<EmittedCss> | undefined

  const prepare = (): Promise<PreparedApp> => {
    prepared ??= prepareApp(config, root)
    return prepared
  }
  const emit = (): Promise<EmittedCss> => {
    emitted ??= prepare().then(emitCss)
    return emitted
  }
  const invalidate = (): void => {
    prepared = undefined
    emitted = undefined
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
      isBuild = resolved.command === 'build'
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
          log(`warning: provider '${w.providerId}' is passed as an object; its classes and tokens are not known (build it with granumProvider() to get a manifest)`)
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
      if (id === RESOLVED_CSS)
        return (await emit()).css
      if (id.startsWith(RESOLVED_LAYER_PREFIX)) {
        const name = id.slice(RESOLVED_LAYER_PREFIX.length).replace(/\.css$/, '') as LayerName
        if (!LAYER_NAMES.includes(name))
          throw new Error(`granum: unknown layer '${name}' (expected one of ${LAYER_NAMES.join(', ')})`)
        return (await emit()).layers[name]
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

    async closeBundle(): Promise<void> {
      if (!isBuild)
        return
      const app = await prepare()
      const css = await emit()
      const report = buildReport(app, css)
      const file = config.report?.file ?? 'granum-report.json'
      if (file !== false) {
        const target = join(resolve(root, outDir), file)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`)
      }
      log(
        `${report.selection.length} components, ${report.classes.matched} classes matched, `
        + `${report.classes.unmatched.length} without a rule, themes [${report.themes.names.join(', ')}]${
          report.prune ? `, prune: ${report.prune.removable.length} removable` : ''
        }${file !== false ? ` → ${join(outDir, file)}` : ''}`,
      )
    },
  }
}
