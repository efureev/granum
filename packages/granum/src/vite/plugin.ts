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
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ComponentOutsideSelectionError, ComponentRootImportError, PluginInstanceReusedError } from '../core/errors'
import { emitCss, LAYER_NAMES, layerOrderDeclaration, wrapLayer } from '../node/emit'
import { findPackageRootImports } from '../node/imports'
import { resolveInlinedCssSources, resolveProviderPath } from '../node/inlinedCss'
import { MANIFEST_FILE_NAME } from '../node/manifest'
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
/** Модули приложения, в коде которых ищутся импорты компонентов из корня пакета. */
const SCRIPT_RE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/
/** Разметка: импорты живут в блоках `<script>` и во frontmatter Astro. */
const MARKUP_RE = /\.(?:vue|svelte|astro)$/
const SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
const FRONTMATTER_RE = /^\s*---\r?\n([\s\S]*?)\r?\n---/

/** Код скриптов разметки: блоки `<script>` и frontmatter, через перевод строки. */
function scriptBlocksOf(markup: string): string {
  const blocks = [...markup.matchAll(SCRIPT_BLOCK_RE)].map(m => m[1]!)
  const frontmatter = FRONTMATTER_RE.exec(markup)?.[1]
  return (frontmatter === undefined ? blocks : [frontmatter, ...blocks]).join('\n')
}

/** Слой при `css.split`: отдельная CSS-точка входа без объявления порядка (A-21). */
const VIRTUAL_SPLIT_PREFIX = 'virtual:granum/split/'
const RESOLVED_SPLIT_PREFIX = `\0${VIRTUAL_SPLIT_PREFIX}`

export interface GranumPluginOptions {
  /** Опции манифеста тем для `virtual:granum/themes`. */
  readonly themeManifest?: GranumThemeManifestOptions
  readonly log?: (line: string) => void
}

/** Слова, которые нельзя взять в `import { … }` без `as`, хотя по форме это идентификатор. */
const RESERVED_WORDS = new Set((
  'await break case catch class const continue debugger default delete do else enum export extends false '
  + 'finally for function if implements import in instanceof interface let new null package private protected '
  + 'public return static super switch this throw true try typeof var void while with yield'
).split(' '))

/** Имя, которое приложение может импортировать как есть: `import { Name } from …`. */
function isImportableName(name: string): boolean {
  return /^[A-Z_$][\w$]*$/i.test(name) && !RESERVED_WORDS.has(name)
}

interface ComponentExport {
  readonly name: string
  readonly from: string
}

/** Компонент селекции, которого в `virtual:granum/components` нет, и почему. */
interface SkippedExport {
  readonly name: string
  readonly reason: 'identifier' | 'ambiguous'
  readonly from: readonly string[]
  readonly providers: readonly string[]
}

/**
 * Реэкспорты `virtual:granum/components`: имя компонента и subpath пакета, из
 * которого он приезжает. Одно место на модуль и на его объявления типов — иначе
 * они разъедутся, и типы будут описывать не то, что импортируется.
 *
 * Реэкспорт по имени возможен не всегда. Контракт допускает имена с дефисом
 * (INV-CON-2), а одно имя может прийти от двух провайдеров. Такая строка ломала
 * бы модуль целиком, и вместе с ним сборку всего, что из него импортирует. Эти
 * имена пропускаются и называются — как у резолвера авто-импорта, который
 * неоднозначное имя тоже не резолвит (A-5).
 */
function componentExports(app: PreparedApp): { exports: ComponentExport[], skipped: SkippedExport[] } {
  const owners = new Map<string, string[]>()
  for (const { provider, component } of app.resolution.selection.entries) {
    if (provider.form !== 'manifest')
      continue
    owners.set(component.name, [...(owners.get(component.name) ?? []), provider.id])
  }
  const exports: ComponentExport[] = []
  const skipped: SkippedExport[] = []
  for (const [name, providers] of owners) {
    const from = providers.map(id => `${id}/components/${name}`)
    if (!isImportableName(name))
      skipped.push({ name, reason: 'identifier', from, providers })
    else if (providers.length > 1)
      skipped.push({ name, reason: 'ambiguous', from, providers })
    else
      exports.push({ name, from: from[0]! })
  }
  return { exports, skipped }
}

function skippedMessage(entry: SkippedExport): string {
  const head = `warning: ${VIRTUAL_COMPONENTS} does not re-export '${entry.name}'`
  if (entry.reason === 'identifier')
    return `${head} — not a JavaScript identifier; import it from ${entry.from.map(f => `'${f}'`).join(' or ')}`
  return `${head} — it is selected from ${entry.providers.join(' and ')}; import it from the package subpath`
}

/**
 * Объявления для `virtual:granum/components` — точные, по селекции: тип берётся
 * из того же subpath, откуда приезжает сам компонент.
 *
 * Пакет поставляет и общий `@feugene/granum/client`, но там имён быть не может:
 * они зависят от конфига приложения, а не от пакета. Поэтому точный вариант —
 * порождаемый, как `components.d.ts` у авто-импорта.
 */
function componentTypes(exports: readonly ComponentExport[]): string {
  return [
    '// Сгенерировано granum по селекции `granum.config`. Правки будут перезаписаны.',
    '',
    'declare module \'virtual:granum/components\' {',
    ...exports.map(e => `  export { ${e.name} } from '${e.from}'`),
    '}',
    '',
  ].join('\n')
}

/**
 * Файлы провайдеров, которые читают подготовка и эмиссия: манифест, инлайнимый
 * CSS, CSS компонентов. В dev за ними следят явно (A-16): пакет-воркспейс лежит
 * вне корня приложения, а симлинк в `node_modules` watcher Vite игнорирует.
 */
function providerFilesOf(app: PreparedApp): string[] {
  const { resolution } = app
  const byId = new Map(resolution.providers.map(p => [p.id, p]))
  const files: string[] = []
  for (const provider of resolution.providers) {
    if (provider.form === 'manifest' && provider.baseUrl !== undefined)
      files.push(fileURLToPath(new URL(MANIFEST_FILE_NAME, provider.baseUrl)))
  }
  for (const source of resolveInlinedCssSources(resolution))
    files.push(source.path)
  for (const ref of resolution.componentCss)
    files.push(resolveProviderPath(ref.path, byId.get(ref.providerId)?.baseUrl))
  return files
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
  /**
   * Отчёт уже написан в этой сборке.
   *
   * Хост вправе собрать несколько окружений Vite одним билдом — Astro строит
   * `prerender`, `ssr` и `client`, — и тогда финальные хуки срабатывают на
   * каждое. Резолюция и эмиссия мемоизированы и от этого не страдают, а отчёт
   * без флага писался бы столько раз, сколько окружений, и печатал бы столько
   * же строк лога об одной и той же сборке.
   */
  let reported = false
  /** Написанный отчёт: окружение, собранное позже, может очистить его каталог (`emptyOutDir`). */
  let reportWritten: { readonly target: string, readonly text: string } | undefined
  /**
   * Этот инстанс уже начал сборку. Конфиг ещё одной сборки после этого — повтор
   * инстанса: окружения одного builder Vite разрешаются до первой из них.
   */
  let buildStarted = false
  /** Слои, уехавшие отдельными ассетами при `css.split`, в порядке слоёв (A-21). */
  let splitLayers: LayerName[] = []
  /** Проставлены ли `<link>` на них: без HTML-точки входа этого не произойдёт. */
  let splitLinked = false
  /** Делит ли Vite CSS по чанкам: без этого он склеит слои обратно в один файл. */
  let cssCodeSplit = true
  let splitWarned = false
  /** Делим ли слои в этой сборке. */
  const splitting = (): boolean => config.css?.split === true && isBuild && !isSsrBuild && cssCodeSplit

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

  /** Файлы провайдеров под наблюдением dev-сервера — реальные пути (A-16). */
  const providerFiles = new Set<string>()
  const watchProviderFiles = (app: PreparedApp): void => {
    if (!server)
      return
    const added: string[] = []
    for (const file of providerFilesOf(app)) {
      let real: string
      try {
        // Симлинк воркспейса ведёт за пределы `node_modules`: по реальному
        // пути игнор watcher Vite файл не задевает. Data URL путём не является.
        real = realpathSync(file)
      }
      catch {
        continue
      }
      if (!providerFiles.has(real)) {
        providerFiles.add(real)
        added.push(real)
      }
    }
    if (added.length > 0)
      server.watcher.add(added)
  }

  const prepare = (): Promise<PreparedApp> => {
    if (prepared === undefined) {
      const started = performance.now()
      prepared = prepareApp(config, root).then((app) => {
        timings.prepare = performance.now() - started
        watchProviderFiles(app)
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
  /*
   * Реэкспорты модуля компонентов. Пропущенные имена называются там, где модулем
   * пользуются, — в `load` и при записи `js.dts`, — и один раз за сборку, хотя
   * в ней бывают оба.
   */
  let componentsWarned = false
  const reexports = (app: PreparedApp): ComponentExport[] => {
    const { exports, skipped } = componentExports(app)
    if (!componentsWarned) {
      componentsWarned = true
      for (const entry of skipped)
        log(skippedMessage(entry))
    }
    return exports
  }

  /*
   * Объявления пишутся только по просьбе (`js.dts`) и только если изменились:
   * запись без нужды дёргала бы watcher dev-сервера на каждый перезапуск.
   */
  const writeComponentTypes = (app: PreparedApp): void => {
    const target = config.js?.dts
    if (target === undefined)
      return
    const file = resolve(root, target)
    const next = componentTypes(reexports(app))
    let current: string | undefined
    try {
      current = readFileSync(file, 'utf8')
    }
    catch {
      current = undefined
    }
    if (current === next)
      return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, next)
    log(`types: ${relative(root, file)}`)
  }

  /** Код виртуальных модулей — то, что отдаёт `load`. */
  const render = async (id: string): Promise<string | null> => {
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
    if (id.startsWith(RESOLVED_SPLIT_PREFIX)) {
      const name = id.slice(RESOLVED_SPLIT_PREFIX.length).replace(/\.css$/, '') as LayerName
      if (!LAYER_NAMES.includes(name))
        throw new Error(`granum: unknown layer '${name}' (expected one of ${LAYER_NAMES.join(', ')})`)
      return wrapLayer((await emit()).layers, name, config.css ?? {}, { declareOrder: false })
    }
    if (id === RESOLVED_COMPONENTS) {
      const app = await prepare()
      return `${reexports(app).map(e => `export { ${e.name} } from '${e.from}'`).join('\n')}\n`
    }
    if (id === RESOLVED_THEMES) {
      const app = await prepare()
      return `export default ${JSON.stringify(getThemeManifest(app.resolution, options.themeManifest ?? {}))}\n`
    }
    return null
  }

  /** Последний отданный dev-серверу код каждого виртуального модуля. */
  const served = new Map<string, string>()
  /*
   * Перезагружается только модуль, чей код изменился (A-16). Модули тем и
   * компонентов — JS без границы HMR: их перезагрузка поднимается до входа
   * приложения, и Vite перезагружает страницу. Правка разметки их код не
   * меняет, а безусловная перезагрузка превращала любую правку в перезагрузку
   * страницы.
   */
  const refresh = async (devServer: ViteDevServer): Promise<void> => {
    for (const [id, before] of served) {
      const mod = devServer.moduleGraph.getModuleById(id)
      if (!mod)
        continue
      let after: string | null | undefined
      try {
        after = await render(id)
      }
      catch {
        // Ошибку покажет оверлеем `load` — ради этого модуль и перезагружается.
        after = undefined
      }
      if (after !== before)
        void devServer.reloadModule(mod)
    }
  }

  const invalidate = (): void => {
    prepared = undefined
    emitted = undefined
    timings.prepare = 0
    timings.emit = 0
    timings.report = 0
    bundleCss = undefined
    reported = false
    reportWritten = undefined
    splitLayers = []
    splitLinked = false
    componentsWarned = false
    if (server)
      void refresh(server)
  }

  /** id провайдера → имена его компонентов; одна карта на резолюцию. */
  const componentNames = new WeakMap<PreparedApp['resolution'], ReadonlyMap<string, ReadonlySet<string>>>()
  const componentsByProvider = (app: PreparedApp): ReadonlyMap<string, ReadonlySet<string>> => {
    let map = componentNames.get(app.resolution)
    if (!map) {
      map = new Map([...app.resolution.registry.providers].map(([id, provider]) => [id, new Set(provider.components.map(c => c.name))]))
      componentNames.set(app.resolution, map)
    }
    return map
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
      // Состояние инстанса — одной сборки: во второй он отдал бы её резолюцию и
      // CSS и не написал бы отчёт. Окружения одного builder сюда не попадают —
      // Vite разрешает их конфиги до первой сборки.
      if (resolved.command === 'build' && buildStarted)
        throw new PluginInstanceReusedError(resolve(root, outDir), resolve(resolved.root, resolved.build.outDir))
      root = resolved.root
      // Каталог берётся из разрешённого конфига, а НЕ из `this.environment` в
      // финальных хуках: у многосредового хоста каталог окружения бывает
      // временным (у Astro `prerender` это `dist/.prerender/`, который хост
      // удаляет после сборки), и отчёт уехал бы вместе с ним.
      outDir = resolved.build.outDir
      base = resolved.base
      isBuild = resolved.command === 'build'
      // Серверная сборка HTML не порождает, ссылки проставлять некуда: слои там
      // не делятся, CSS приезжает одним модулем, как и раньше.
      isSsrBuild = Boolean(resolved.build.ssr)
      cssCodeSplit = resolved.build.cssCodeSplit !== false
      if (config.css?.split === true && isBuild && !isSsrBuild && !cssCodeSplit && !splitWarned) {
        splitWarned = true
        log(`warning: css.split needs build.cssCodeSplit — Vite merges all CSS into one file, so the layers ship as one asset`)
      }
    },

    configureServer(devServer: ViteDevServer): void {
      server = devServer
      const dirs = (config.appSources?.dirs ?? []).map(d => resolve(root, d))
      const onChange = (file: string): void => {
        if (dirs.some(dir => file.startsWith(`${dir}/`) || file.startsWith(`${dir}\\`)))
          invalidate()
        else if (providerFiles.has(file) || file.endsWith('granum.manifest.json'))
          invalidate()
      }
      devServer.watcher.on('change', onChange)
      devServer.watcher.on('add', onChange)
      devServer.watcher.on('unlink', onChange)
    },

    /*
     * `vite build --watch`: файл изменился — следующая сборка новая, и всё
     * мемоизированное (резолюция, эмиссия, «отчёт уже написан») обязано
     * сброситься. Не в `buildStart`: многосредовый хост зовёт его на каждое
     * окружение одной сборки, и отчёт писался бы по разу на окружение. Сюда же
     * хост без watch не приходит вовсе.
     */
    watchChange(): void {
      invalidate()
    },

    async buildStart(): Promise<void> {
      if (isBuild)
        buildStarted = true
      const app = await prepare()
      for (const w of app.warnings) {
        if (w.kind === 'provider-without-manifest')
          log(`warning: provider '${w.providerId}' is passed as an object and its baseUrl is not on disk; its classes and tokens are not known (build it with granumProvider() to get a manifest)`)
        else if (w.kind === 'provider-scanned')
          log(`provider '${w.providerId}' has no manifest: classes and tokens scanned from its dist (slow path)`)
        else if (w.kind === 'imports-without-app-sources')
          log(`warning: components: 'imports' needs appSources.dirs — the selection is empty`)
        else if (w.kind === 'app-sources-unset')
          log(`warning: appSources is not set — classes in the application markup are not scanned and get no CSS; set appSources: { dirs: ['src'] }, or dirs: [] if the markup has no classes of its own`)
      }
      writeComponentTypes(app)

      /*
       * Ассеты слоёв (A-21) — CSS-точки входа, а не готовые строки: так каждый
       * слой проходит CSS-конвейер Vite, как любой CSS сборки, — PostCSS,
       * минификацию и `build.cssTarget`. JS-заглушку «чисто CSS» Vite убирает
       * сам. Имя чанка — с `.css`: из него Vite строит имя ассета, и
       * `granum.tokens` без расширения превратилось бы в `granum.css` у всех
       * слоёв. Пустые слои пропускаются — ассета и запроса за ним быть не должно.
       */
      if (splitting()) {
        const css = await emit()
        const options = config.css ?? {}
        splitLayers = []
        for (const layer of LAYER_NAMES) {
          if (!wrapLayer(css.layers, layer, options, { declareOrder: false }))
            continue
          this.emitFile({ type: 'chunk', id: `${VIRTUAL_SPLIT_PREFIX}${layer}.css`, name: assetNameOf(layer) })
          splitLayers.push(layer)
        }
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
      if (source.startsWith(VIRTUAL_SPLIT_PREFIX))
        return `\0${source}`

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

    /*
     * Компонент — только из подпути или виртуального модуля. Импорт из корня
     * пакета guard в `resolveId` не видит: там нет имён, а имя компонента и
     * решает. Поэтому проверка — по исходному коду модуля, до остальных
     * трансформов: позже Vite в dev переписывает спецификаторы в пути файлов.
     * У SFC и разметки проверяются блоки `<script>` и frontmatter.
     */
    async transform(code, id) {
      const guard = config.js?.guard ?? 'error'
      const path = id.replace(/[?#].*$/, '')
      if (guard === 'off' || id.startsWith('\0') || id.includes('/node_modules/') || id.includes('?') || !SCRIPT_RE.test(path))
        return null
      const app = await prepare()
      const source = MARKUP_RE.test(path) ? scriptBlocksOf(code) : code
      for (const found of findPackageRootImports(source, componentsByProvider(app))) {
        const error = new ComponentRootImportError(found.providerId, found.components, found.whole, relative(root, path))
        if (guard === 'error')
          throw error
        log(`warning: ${error.message}`)
      }
      return null
    },

    async load(id) {
      const code = await render(id)
      // Отданный код запоминается: `refresh` сравнит с ним новый.
      if (code !== null && server)
        served.set(id, code)
      return code
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
      if (reported) {
        // Окружение, собранное позже, очищает свой каталог (`emptyOutDir`), и
        // отчёт, если лежал там, пропал бы. Возвращается тот же текст, без новой
        // строки лога: сборка одна.
        if (reportWritten && !existsSync(reportWritten.target)) {
          mkdirSync(dirname(reportWritten.target), { recursive: true })
          writeFileSync(reportWritten.target, reportWritten.text)
        }
        return
      }
      reported = true
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
        const text = `${JSON.stringify(report, null, 2)}\n`
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, text)
        reportWritten = { target, text }
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
      log(
        `time ${ms(timings.prepare + timings.emit + timings.report)} ms `
        + `(prepare ${ms(timings.prepare)} [manifests ${ms(app.timings.providers)}, scan ${ms(app.timings.appScan)}, resolve ${ms(app.timings.resolve)}], `
        + `emit ${ms(timings.emit)}, report ${ms(timings.report)})`,
      )
    },
  }
}
