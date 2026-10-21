/**
 * Плагин приложения `granum()` — оркестратор конвейера. Одна
 * резолюция на билд кормит три канала: CSS (`virtual:granum.css`
 * и срезы по слоям), JS (`virtual:granum/components` и guard импортов),
 * токены и темы (`virtual:granum/themes`). В dev правка исходников
 * приложения пересобирает только то, что от них зависит.
 */
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite'
import type { GranumConfig } from '../config'
import type { GranumAppTheme } from '../core/resolveThemes'
import type { EmittedCss, LayerName } from '../node/emit'
import type { PreparedApp } from '../node/prepare'
import type { ThemeManifestOptions } from '../node/themeManifest'
import type { GranumThemeManifest } from '../runtime/manifest'
import type { GranumThemeScriptOptions } from '../runtime/script'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ComponentOutsideSelectionError, ComponentRootImportError, PluginInstanceReusedError } from '../core/errors'
import { ownerOf } from '../core/providerNode'
import { normalizeThemeEntry } from '../core/resolveThemes'
import { emitCss, LAYER_NAMES, layerOrderDeclaration, wrapLayer } from '../node/emit'
import { findPackageRootImports } from '../node/imports'
import { resolveInlinedCssSources, resolveProviderPath } from '../node/inlinedCss'
import { MANIFEST_FILE_NAME } from '../node/manifest'
import { prepareApp } from '../node/prepare'
import { buildReportFromBundles } from '../node/report'
import { emitThemeCss } from '../node/themeCss'
import { getThemeManifest, resolveThemeManifest } from '../node/themeManifest'
import { createThemeScriptCode } from '../runtime/script'
import { validateGranumConfig } from './validateConfig'

export const VIRTUAL_CSS = 'virtual:granum.css'
export const VIRTUAL_LAYER_PREFIX = 'virtual:granum/layers/'
/** Листы всех дополнительных тем сборки. */
export const VIRTUAL_THEME_SHEETS = 'virtual:granum/themes.css'
/** Лист одной дополнительной темы: `virtual:granum/themes/<id>.css`. */
export const VIRTUAL_THEME_SHEET_PREFIX = 'virtual:granum/themes/'
export const VIRTUAL_COMPONENTS = 'virtual:granum/components'
export const VIRTUAL_THEMES = 'virtual:granum/themes'

const RESOLVED_CSS = `\0${VIRTUAL_CSS}`
const RESOLVED_LAYER_PREFIX = `\0${VIRTUAL_LAYER_PREFIX}`
const RESOLVED_THEME_SHEETS = `\0${VIRTUAL_THEME_SHEETS}`
const RESOLVED_THEME_SHEET_PREFIX = `\0${VIRTUAL_THEME_SHEET_PREFIX}`
/**
 * Лист дополнительной темы как файл: адрес из манифеста ведёт на него. Id
 * без `\0` и с `.css` — так импорт `?url` проходит CSS-конвейер Vite
 * (PostCSS, lightningcss, минификация, `build.cssTarget`), как общий лист, а в
 * dev этот адрес отдаёт сам dev-сервер.
 */
const THEME_SHEET_FILE_PREFIX = '/@granum-theme/'
/** Имя ассета листа дополнительной темы: под ним он и ищется в бандле. */
const themeSheetAssetName = (theme: string): string => `granum-theme-${theme}.css`
const themeSheetFile = (theme: string): string => `${THEME_SHEET_FILE_PREFIX}${themeSheetAssetName(theme)}`
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

/** Слой при `css.split`: отдельная CSS-точка входа без объявления порядка. */
const VIRTUAL_SPLIT_PREFIX = 'virtual:granum/split/'
const RESOLVED_SPLIT_PREFIX = `\0${VIRTUAL_SPLIT_PREFIX}`

export interface GranumPluginOptions {
  /**
   * Вставить в `<head>` HTML-точки входа скрипт, который ставит пару режима до
   * первого кадра (`createThemeScriptCode`). `true` — с ключом хранилища по
   * умолчанию. SSR-приложение вставляет скрипт само.
   */
  readonly themeScript?: boolean | Omit<GranumThemeScriptOptions, 'manifest'>
  readonly log?: (line: string) => void
}

/** `plugin.api` — то, что интеграции хоста читают у плагина до сборки. */
export interface GranumPluginApi {
  /**
   * Манифест режимов сборки — тот же, что `virtual:granum/themes`, но
   * доступный на этапе конфигурации хоста: скрипт режима в `<head>` строится
   * раньше, чем Vite начнёт сборку. `root` — корень приложения; без него —
   * корень Vite, а до разрешения его конфига — текущий каталог процесса.
   */
  readonly themeManifest: (root?: string) => Promise<GranumThemeManifest>
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
 * они разъедутся, и типы будут описывать не то, что импортируется. Части
 * выбранного составного компонента реэкспортируются тоже, своими подпутями: их
 * код — в модуле владельца, который и так в селекции.
 *
 * Реэкспорт по имени возможен не всегда. Контракт допускает имена с дефисом,
 * а одно имя может прийти от двух провайдеров. Такая строка ломала
 * бы модуль целиком, и вместе с ним сборку всего, что из него импортирует. Эти
 * имена пропускаются и называются — как у резолвера авто-импорта, который
 * неоднозначное имя тоже не резолвит.
 */
function componentExports(app: PreparedApp): { exports: ComponentExport[], skipped: SkippedExport[] } {
  const owners = new Map<string, string[]>()
  for (const { provider, component } of app.resolution.selection.entries) {
    if (provider.form !== 'manifest')
      continue
    const parts = [...(provider.subcomponents ?? [])].filter(([, owner]) => owner === component.name).map(([part]) => part)
    for (const name of [component.name, ...parts])
      owners.set(name, [...(owners.get(name) ?? []), provider.id])
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
 * CSS, CSS компонентов. В dev за ними следят явно: пакет-воркспейс лежит
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
  // Данные тем сборки: правка JSON темы у провайдера-воркспейса.
  for (const { theme } of resolution.themes.themes) {
    const provider = byId.get(theme.providerId)
    const entry = provider?.theme.catalog[theme.id]
    if (provider && entry)
      files.push(resolveProviderPath(entry.data, provider.baseUrl))
  }
  return files
}

/**
 * Имя ассета → файл в бандле. Имя с хешем присваивает бандлер, поэтому берём
 * его из самого бандла по имени, под которым ассет эмитился: ссылка по `ref` в
 * `transformIndexHtml` не типизирована, а бандл — типизирован и уже собран.
 */
function assetFileNames(bundle: Record<string, unknown>): Map<string, string> {
  const byName = new Map<string, string>()
  for (const item of Object.values(bundle)) {
    const asset = item as { type?: string, name?: string, names?: readonly string[], fileName?: string }
    if (asset.type !== 'asset' || typeof asset.fileName !== 'string')
      continue
    for (const name of [asset.name, ...(asset.names ?? [])]) {
      if (typeof name === 'string')
        byName.set(name, asset.fileName)
    }
  }
  return byName
}

/** Файлы, из которых приложение собрало тему-объект и его родителей-объекты: их правка перезагружает конфиг. */
export function themeSourcesOf(config: GranumConfig, root: string): string[] {
  const files = new Set<string>()
  const visit = (choice: unknown, seen: readonly unknown[]): void => {
    if (typeof choice !== 'object' || choice === null || seen.includes(choice))
      return
    const theme = choice as GranumAppTheme
    for (const file of theme.sources ?? [])
      files.add(resolve(root, file))
    visit(theme.extends, [...seen, choice])
  }
  for (const entry of config.themes ?? [])
    visit(normalizeThemeEntry(entry).theme, [])
  return [...files]
}

/**
 * Каталог отчёта. Отдельная сборка — её `outDir`. Builder Vite разрешает конфиг
 * каждого окружения, и последний разрешённый зависел бы от порядка их
 * объявления; поэтому берётся клиентское окружение — его каталог постоянный, в
 * отличие от временного у `prerender` Astro (`dist/.prerender/`, хост удаляет его
 * после сборки). Клиентских нет или их несколько — первое по имени.
 */
function reportDirOf(resolved: ResolvedConfig): string {
  if (!resolved.builder)
    return resolved.build.outDir
  const named = Object.entries(resolved.environments).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const [, chosen] = named.find(([, env]) => env.consumer === 'client') ?? named[0] ?? []
  return chosen?.build.outDir ?? resolved.build.outDir
}

/** Имя ассета слоя до присвоения хеша: по нему он потом находится в бандле. */
function assetNameOf(layer: LayerName): string {
  return `granum.${layer}.css`
}

export function granum(config: GranumConfig, options: GranumPluginOptions = {}): Plugin<GranumPluginApi> {
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
  /**
   * CSS-ассеты бандла каждого окружения сборки: объявленные классы и размеры
   * слоёв в отчёте. Окружение без CSS-ассетов сюда не попадает — о CSS
   * приложения его бандл ничего не знает.
   */
  const bundleCss = new Map<string, { readonly client: boolean, readonly css: string }>()
  /** Окружение принесло CSS после последнего отчёта: отчёт надо пересчитать. */
  let bundleCssChanged = false
  /**
   * Отчёт этой сборки уже построен.
   *
   * Хост вправе собрать несколько окружений Vite одним билдом — Astro строит
   * `prerender`, `ssr` и `client`, — и тогда финальные хуки срабатывают на
   * каждое. Резолюция и эмиссия мемоизированы и от этого не страдают. Отчёт
   * пересчитывается, только когда окружение принесло CSS: итог считается по CSS
   * всех окружений и не зависит от их порядка, а строка сборки печатается
   * заново, лишь если итог изменился.
   */
  let reported = false
  /** Последний отчёт и его файл: окружение, собранное позже, может очистить каталог (`emptyOutDir`). */
  let reportWritten: { readonly target: string | undefined, readonly text: string } | undefined
  /** Последняя напечатанная строка сборки. */
  let lastSummary: string | undefined
  /**
   * Этот инстанс уже начал сборку. Конфиг ещё одной сборки после этого — повтор
   * инстанса: окружения одного builder Vite разрешаются до первой из них.
   */
  let buildStarted = false
  /** Слои, уехавшие отдельными ассетами при `css.split`, в порядке слоёв. */
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
   * между сборками, а время стабильным не бывает.
   *
   * Фазы: `prepare` — манифесты, пересчёт классов, скан исходников и резолюция;
   * `emit` — генератор утилит и сборка слоёв; `report` — размеры слоёв со
   * сжатием и запись файла. Всё остальное в сборке (vue, rolldown) — не granum.
   */
  const timings = { prepare: 0, emit: 0, report: 0 }

  /** Файлы провайдеров под наблюдением dev-сервера — реальные пути. */
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

  /**
   * Лист дополнительной темы. Основная и чужая тема — ошибка: модуль, молча
   * пустой, не дал бы теме ни одного значения, и никто бы этого не увидел.
   */
  const themeSheetOf = async (theme: string): Promise<string> => {
    const app = await prepare()
    const { themeSheets } = await emit()
    if (theme === app.resolution.themes.default?.theme.id)
      throw new Error(`granum: '${theme}' is the default theme of this build — its blocks are in ${VIRTUAL_CSS}, it has no sheet of its own`)
    if (!(theme in themeSheets))
      throw new Error(`granum: '${theme}' is not an additional theme of this build (additional themes: ${Object.keys(themeSheets).join(', ') || '—'})`)
    return themeSheets[theme]!
  }

  /** Адрес листа в dev: файл листа отдаёт dev-сервер. */
  const devThemeSheetHref = (theme: string): string => `${base.endsWith('/') ? base : `${base}/`}${themeSheetFile(theme).slice(1)}`

  /**
   * Дополнительные темы с непустым листом — только у них есть адрес. Один список
   * для манифеста и скрипта до первого кадра: иначе скрипт выбрал бы тему, которой
   * контроллер не знает. Считается по резолюции, без движка: адресу утилиты не нужны.
   */
  const sheetThemes = async (): Promise<string[]> =>
    emitThemeCss((await prepare()).resolution).additional.filter(sheet => sheet.base.length > 0 || sheet.themes.length > 0).map(sheet => sheet.id)

  /**
   * Адрес ассета для страницы: абсолютный `base` — как есть, относительный — от
   * каталога страницы. Так `base: './'` ставит Vite свои ссылки, и страница в
   * подкаталоге не ушла бы в `docs/assets/…`.
   */
  const assetHref = (file: string, page: string): string => {
    if (base !== '' && !base.startsWith('.'))
      return `${base.endsWith('/') ? base : `${base}/`}${file}`
    const href = posix.relative(posix.dirname(page.startsWith('/') ? page : `/${page}`), `/${file}`)
    return href.startsWith('.') ? href : `./${href}`
  }

  const themeManifestOf = async (href: ThemeManifestOptions['href']): Promise<GranumThemeManifest> =>
    getThemeManifest((await prepare()).resolution, href ? { href } : {})

  /**
   * Модуль манифеста: адрес листа каждой дополнительной темы — импорт `?url`
   * файла листа. Бандлер сам выпустит лист ассетом с хешем, подставит имя файла
   * и `base`, а хеш модуля манифеста учтёт хеш листа.
   */
  const themeManifestModule = async (): Promise<string> => {
    const themes = await sheetThemes()
    // В dev — адрес строкой: `?url` дал бы `<base>@fs/@granum-theme/…`, а скрипт до
    // первого кадра ставит `<base>@granum-theme/…`, и адрес у темы был бы не один.
    if (!isBuild)
      return `export default ${JSON.stringify(await themeManifestOf(theme => (themes.includes(theme) ? devThemeSheetHref(theme) : undefined)))}\n`
    const placeholder = (i: number): string => `__GRANUM_THEME_SHEET_${i}__`
    let code = JSON.stringify(await themeManifestOf(theme => (themes.includes(theme) ? placeholder(themes.indexOf(theme)) : undefined)))
    themes.forEach((_, i) => {
      code = code.replace(JSON.stringify(placeholder(i)), `sheet${i}`)
    })
    const imports = themes.map((theme, i) => `import sheet${i} from '${themeSheetFile(theme)}?url'\n`).join('')
    return `${imports}export default ${code}\n`
  }

  /** Код виртуальных модулей — то, что отдаёт `load`. */
  const render = async (id: string): Promise<string | null> => {
    if (id === RESOLVED_CSS) {
      /*
       * При `split` содержимое уезжает отдельными ассетами, и здесь остаётся
       * ровно объявление порядка слоёв. Оно обязано быть первым, и
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
    if (id === RESOLVED_THEME_SHEETS)
      return Object.values((await emit()).themeSheets).join('\n')
    if (id.startsWith(RESOLVED_THEME_SHEET_PREFIX))
      return themeSheetOf(id.slice(RESOLVED_THEME_SHEET_PREFIX.length).replace(/\.css$/, ''))
    // Файл листа приходит с запросами Vite (`?direct`, `?transform-only`); `?url`
    // отдаём Vite: адрес ассета считает он, а плагин `pre` перехватил бы импорт.
    if (id.startsWith(THEME_SHEET_FILE_PREFIX) && !/[?&]url\b/.test(id))
      return themeSheetOf(id.replace(/[?#].*$/, '').slice(THEME_SHEET_FILE_PREFIX.length).replace(/^granum-theme-/, '').replace(/\.css$/, ''))
    if (id === RESOLVED_COMPONENTS) {
      const app = await prepare()
      return `${reexports(app).map(e => `export { ${e.name} } from '${e.from}'`).join('\n')}\n`
    }
    if (id === RESOLVED_THEMES)
      return themeManifestModule()
    return null
  }

  /** Последний отданный dev-серверу код каждого виртуального модуля. */
  const served = new Map<string, string>()
  /*
   * Перезагружается только модуль, чей код изменился. Модули тем и
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

  /**
   * Ранний скрипт — последним в `<head>`, после стилей страницы: пару он и так
   * ставит до первого кадра, а лист дополнительной темы, который он вставляет,
   * объявляет слои granum. Встав раньше стилей, лист объявил бы `granum` до
   * слоёв приложения, и те перебили бы его. Адреса листов — из бандла на
   * сборке и dev-сервера в dev: тема без адреса в выбор скрипта не попадает.
   */
  const themeScriptTags = async (bundle: Record<string, unknown> | undefined, page: string): Promise<{ tag: string, attrs?: Record<string, string>, children: string, injectTo: 'head' }[]> => {
    if (!options.themeScript)
      return []
    const themes = await sheetThemes()
    const fromBundle = bundle ? assetFileNames(bundle) : undefined
    // На сборке адрес — только из бандла: хост, зовущий хук без него (пререндер),
    // получил бы dev-адрес, которого в продакшене нет. Тема без адреса в выбор
    // скрипта не попадает.
    const manifest = await themeManifestOf((theme) => {
      if (!themes.includes(theme))
        return undefined
      if (!isBuild)
        return devThemeSheetHref(theme)
      const file = fromBundle?.get(themeSheetAssetName(theme))
      return file !== undefined ? assetHref(file, page) : undefined
    })
    const main = manifest.themes.find(theme => theme.id === manifest.defaultTheme)
    if (!main || main.modes.length === 0)
      return []
    const { nonce, ...code } = options.themeScript === true ? {} : options.themeScript
    return [{ tag: 'script', ...(nonce !== undefined ? { attrs: { nonce } } : {}), children: createThemeScriptCode({ manifest, ...code }), injectTo: 'head' }]
  }

  const invalidate = (): void => {
    prepared = undefined
    emitted = undefined
    timings.prepare = 0
    timings.emit = 0
    timings.report = 0
    bundleCss.clear()
    bundleCssChanged = false
    reported = false
    reportWritten = undefined
    lastSummary = undefined
    splitLayers = []
    splitLinked = false
    componentsWarned = false
    if (server)
      void refresh(server)
  }

  /** Отчёт на месте: окружение, собранное позже, очищает свой каталог, и файл возвращается тем же текстом. */
  const restoreReport = (): void => {
    const target = reportWritten?.target
    if (target === undefined || existsSync(target))
      return
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, reportWritten!.text)
  }

  /**
   * CSS окружений в порядке предпочтения для размеров слоёв: клиентские первыми,
   * дальше по имени — не в порядке сборки.
   */
  const reportBundles = (): string[] => [...bundleCss]
    .sort(([a, x], [b, y]) => (x.client !== y.client ? (x.client ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => entry.css)

  /**
   * id провайдера → имена его компонентов и частей составных компонентов; одна
   * карта на резолюцию. Часть из корня пакета тянет корень так же, как компонент.
   */
  const componentNames = new WeakMap<PreparedApp['resolution'], ReadonlyMap<string, ReadonlySet<string>>>()
  const componentsByProvider = (app: PreparedApp): ReadonlyMap<string, ReadonlySet<string>> => {
    let map = componentNames.get(app.resolution)
    if (!map) {
      map = new Map([...app.resolution.registry.providers].map(([id, provider]) => [
        id,
        new Set([...provider.components.map(c => c.name), ...(provider.subcomponents?.keys() ?? [])]),
      ]))
      componentNames.set(app.resolution, map)
    }
    return map
  }

  /**
   * Компонент подпути `<pkg>/components/<Name>`: ключ владельца и часть, если
   * подпуть — её. Часть живёт в модуле владельца, и судится владелец.
   */
  const componentOfSubpath = (app: PreparedApp, source: string): { readonly key: string, readonly part?: string } | undefined => {
    const m = /^(@[^/]+\/[^/]+|[^./@][^/]*)\/components\/([^/?#]+)$/.exec(source)
    if (!m)
      return undefined
    const [, pkg, name] = m
    const provider = app.resolution.registry.providers.get(pkg!)
    const owner = provider ? ownerOf(provider, name!) : undefined
    if (!owner)
      return undefined
    return owner.name === name ? { key: `${pkg}:${name}` } : { key: `${pkg}:${owner.name}`, part: name! }
  }

  const api: GranumPluginApi = {
    themeManifest: async (at?: string) => resolveThemeManifest({
      providers: config.providers,
      ...(config.themes !== undefined ? { themes: config.themes } : {}),
      ...(config.activation !== undefined ? { activation: config.activation } : {}),
      root: at ?? root,
    }),
  }

  return {
    name: 'granum:app',
    api,
    // `pre`: иначе `vite:resolve` разрешит `<pkg>/components/<Name>` раньше нас,
    // и guard импортов не увидит ни одного спецификатора.
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
      // временным, и отчёт уехал бы вместе с ним.
      outDir = reportDirOf(resolved)
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
      // Тема-объект живёт в конфиге, а конфиг читается один раз на процесс
      // Vite: правку её файлов подхватывает только перезапуск сервера.
      const themeSources = themeSourcesOf(config, root)
      const sourceDirs = themeSources.filter(file => existsSync(file) && statSync(file).isDirectory())
      if (themeSources.length > 0)
        devServer.watcher.add(themeSources)
      const onChange = (file: string): void => {
        if (themeSources.includes(file) || sourceDirs.some(dir => file.startsWith(`${dir}/`) || file.startsWith(`${dir}\\`))) {
          log(`theme source changed: ${relative(root, file)} — restarting to reload the config`)
          void devServer.restart()
          return
        }
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
      // Выход за `targets` виден без `doctor` (A-38): тема написана под другие версии пакетов.
      for (const w of app.resolution.warnings) {
        if (w.kind === 'theme-target-mismatch')
          log(`warning: theme '${w.theme}' is written for ${w.providerId} ${w.range}, the build has ${w.version} — run 'granum doctor' to see what the theme misses`)
      }
      writeComponentTypes(app)

      /*
       * Ассеты слоёв — CSS-точки входа, а не готовые строки: так каждый
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
      if (source.startsWith(VIRTUAL_LAYER_PREFIX) || source === VIRTUAL_THEME_SHEETS || source.startsWith(VIRTUAL_THEME_SHEET_PREFIX))
        return `\0${source}`
      if (source.startsWith(THEME_SHEET_FILE_PREFIX))
        return source
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
      const found = componentOfSubpath(app, source)
      if (found === undefined || app.resolution.selection.order.includes(found.key as never))
        return null
      // Импортёр SFC приходит с запросом блока (`App.vue?vue&type=script…`): называем файл.
      const error = new ComponentOutsideSelectionError(found.key, relative(root, importer.replace(/[?#].*$/, '')), app.resolution.selection.order, found.part)
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
      async handler(html: string, ctx: { path?: string, bundle?: Record<string, unknown> }) {
        const scriptTags = await themeScriptTags(ctx.bundle, ctx.path ?? '/index.html')
        if (!splitting() || splitLayers.length === 0)
          return scriptTags.length > 0 ? scriptTags : html
        const byName = assetFileNames(ctx.bundle ?? {})
        const links = splitLayers
          .map(layer => byName.get(assetNameOf(layer)))
          .filter((fileName): fileName is string => fileName !== undefined)
        if (links.length !== splitLayers.length)
          return scriptTags.length > 0 ? scriptTags : html
        splitLinked = true
        // База обязательна: приложение может жить не в корне домена, и Vite
        // проставляет её своим ссылкам — наши не имеют права отличаться.
        const prefix = base.endsWith('/') ? base : `${base}/`
        // Скрипт — после срезов: лист темы, который он вставит, идёт за ними.
        return [...links.map(href => ({
          tag: 'link',
          attrs: { rel: 'stylesheet', href: `${prefix}${href}` },
          injectTo: 'head' as const,
        })), ...scriptTags]
      },
    },

    generateBundle(_options, bundle): void {
      // Листы дополнительных тем — не общий лист: каждая страница их не грузит, и в
      // размеры слоёв отчёта они не входят.
      const sheets = new Set([...assetFileNames(bundle)].filter(([name]) => name.startsWith('granum-theme-') && name.endsWith('.css')).map(([, fileName]) => fileName))
      const parts: string[] = []
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name]
        if (item && item.type === 'asset' && name.endsWith('.css') && typeof item.source === 'string' && !sheets.has(name))
          parts.push(item.source)
      }
      // Серверный вход, который CSS не импортирует, судил бы разметку по пустому CSS.
      if (parts.length === 0)
        return
      bundleCss.set(this.environment.name, { client: this.environment.config.consumer === 'client', css: parts.join('\n') })
      bundleCssChanged = true
    },

    async closeBundle(): Promise<void> {
      if (!isBuild)
        return
      if (reported && !bundleCssChanged) {
        restoreReport()
        return
      }
      bundleCssChanged = false
      const app = await prepare()
      const css = await emit()
      if (!reported) {
        reported = true
        // Без HTML-точки входа ссылки проставить некуда, и CSS не приедет вовсе:
        // это тихая поломка, поэтому говорим о ней громко.
        if (splitting() && splitLayers.length > 0 && !splitLinked) {
          log(
            `warning: css.split is on, ${splitLayers.length} layer asset(s) were emitted, but no HTML entry was found to link them `
            + `— the CSS will not load. Drop css.split or add an HTML entry.`,
          )
        }
      }
      const reportStarted = performance.now()
      const report = buildReportFromBundles(app, css, reportBundles())
      const text = `${JSON.stringify(report, null, 2)}\n`
      // Окружение принесло CSS, но итог тот же: ни записи, ни новой строки лога.
      if (reportWritten?.text === text) {
        restoreReport()
        return
      }
      const file = config.report?.file ?? 'granum-report.json'
      const target = file !== false ? join(resolve(root, outDir), file) : undefined
      if (target !== undefined) {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, text)
      }
      reportWritten = { target, text }
      timings.report = performance.now() - reportStarted
      const summary = `${report.selection.length} components, ${report.classes.matched} classes matched, `
        + `${report.classes.unmatched.length} without a rule, themes ${report.themes.themes.map(theme => `${theme.id}${theme.default ? '*' : ''} [${theme.modes.join(', ')}]`).join(', ') || '—'}${
          report.prune ? `, prune: ${report.prune.removable.length} removable` : ''
        }${splitting() && splitLayers.length > 0 ? `, css: ${splitLayers.length} layer assets` : ''}${file !== false ? ` → ${join(outDir, file)}` : ''}`
      // Отчёт мог измениться в том, чего строка не называет (размеры слоёв):
      // повторять ту же строку незачем.
      if (summary === lastSummary)
        return
      lastSummary = summary
      log(summary)
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
