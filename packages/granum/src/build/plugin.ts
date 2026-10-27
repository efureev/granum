/**
 * Плагин сборки провайдера `granumProvider()`. Один плагин вместо трёх
 * хелперов v1 и ручного списка entry: строит entry по реестру компонентов,
 * раскладывает чанки и CSS по контракту, извлекает классы и токены по графу
 * бандла, копирует объявленный CSS, раскрывает `@apply`, проверяет границу
 * browser/node и пишет `granum.manifest.json`.
 */
import type { Plugin, ResolvedConfig, Rolldown, UserConfig } from 'vite'
import type { GranumComponentDescriptor, GranumComponentThemeTokens, GranumManifest, GranumManifestCatalogEntry, GranumManifestWarning, GranumProvider, GranumThemeCatalogEntry, GranumThemeData } from '../contract'
import type { InvalidProviderReason } from '../core/errors'
import type { ProviderNode } from '../core/providerNode'
import type { GranumAppTheme } from '../core/resolveThemes'
import type { ThemePatch, TokenNature } from '../core/themeData'
import type { GranumEngine } from '../engine/types'
import type { BoundaryViolation, BundleAnalysis, BundleLike } from './graph'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { normalizePath } from 'vite'
import { GRANUM_CONTRACT_VERSION, GRANUM_MANIFEST_VERSION } from '../contract'
import { validateProvider } from '../contract/validate'
import { sortedUnique } from '../core/dedupe'
import { BoundaryViolationError, CssReadError, EngineDialectMismatchError, InvalidProviderError, ManifestNotFoundError, PackageExportsError, ThemeSourceError, UndeclaredDependencyError } from '../core/errors'
import { ownerOf, toProviderNode } from '../core/providerNode'
import { splitComponentKey } from '../core/registry'
import { checkThemeData, DEFAULT_MODE, flattenThemeComponents, mergeThemePatch, missingRegistryTokens, themeModeOrder, themeTokenNames } from '../core/themeData'
import { scanCssDeclarations } from '../node/cssDeclarations'
import { collectImportSpecifiers } from '../node/imports'
import { loadPackageManifest, MANIFEST_FILE_NAME, normalizePackagePath, writeManifestSync } from '../node/manifest'
import { subcomponentsFromExports } from '../node/subcomponents'
import { readComponentThemesDir, readRegistry, readThemeDataFile, themeDataError } from '../node/themeFiles'
import { loadThemeSource } from '../node/themeSource'
import { extractRequiredTokenUses, fallbackOnlyTokens, scanTokenConsumption } from '../node/tokenScan'
import { GRANUM_VERSION } from '../version'
import { expandApply } from './apply'
import { analyzeBundle, findUndeclaredEdges, nodeOnlyModules } from './graph'
import { collectComponentSources, componentEntryFileName, GRANUM_CONTRACT_CHUNK, granumAssetFileNames, granumChunkFileNames } from './layout'
import { findMissingPeers } from './peers'

/** Дополнительная точка входа провайдера. */
export interface GranumProviderEntry {
  /** Путь относительно корня пакета. */
  readonly path: string
  /**
   * `node` — точка входа только для Node: она не корень проверки границы
   * browser/node, а встроенные модули Node в сборке остаются внешними. По
   * умолчанию `browser`.
   */
  readonly env?: 'browser' | 'node'
}

export interface GranumProviderPluginOptions {
  /** Объект контракта провайдера — браузерный entry пакета. */
  readonly provider: GranumProvider
  /** Каталог исходников, зеркалящий раскладку `dist` для файлов темы (`src/theme/base.css` ↔ `theme/base.css`, `src/themes/slate.json` ↔ `themes/slate.json`). По умолчанию `src`. */
  readonly sourceDir?: string
  /** Корневой entry пакета (`index`). По умолчанию `src/index.ts`, если существует; `false` — не добавлять. */
  readonly indexEntry?: string | false
  /** Дополнительные entry: имя → путь относительно корня пакета или `{ path, env }`. */
  readonly entries?: Readonly<Record<string, string | GranumProviderEntry>>
  /** Неучтённое ребро графа компонентов: ошибка (по умолчанию) или предупреждение. */
  readonly dependencyCheck?: 'error' | 'warn'
  /** Нарушение границы browser/node в бандле. По умолчанию `error`. */
  readonly boundaryCheck?: 'error' | 'warn'
  /** Проверка `package.json#exports`. По умолчанию `error`. */
  readonly exportsCheck?: 'error' | 'warn' | 'off'
  /**
   * Движок утилит — инстанс. Им фильтруются классы манифеста, и его
   * диалект с отпечатком уезжают в блок `engine`: список классов — факт о
   * конкретной реализации, а не о пакете.
   */
  readonly engine: GranumEngine
  /** Модуль с правилами движка провайдера — путь относительно `dist` для манифеста. */
  readonly engineModule?: string | null
  readonly manifestFile?: string
  /** Дополнительный внешний список для rolldown (`vue` и т.п. провайдер задаёт сам). */
  readonly log?: (line: string) => void
}

/** Запись каталога на сборке: готовые данные или исходник темы; `data` — путь данных в `dist`. */
type CatalogPath
  = | { readonly kind: 'data', readonly data: string }
    | { readonly kind: 'source', readonly source: string, readonly ignore: readonly string[], readonly data: string }

/** Метаданные записи индекса каталога — из записи или из theme.json исходника. */
interface CatalogMeta {
  readonly title: string
  readonly description?: string
  readonly docs?: string
  readonly extends?: string
}

interface ComponentSourceEntry {
  readonly descriptor: GranumComponentDescriptor
  readonly dir: string
  readonly entry: string
}

/**
 * Ядро granum — peer пакета провайдера, а не его содержимое: в сборку не
 * вклеивается. Кроме `./contract` и `./runtime`: они без зависимостей и
 * безопасны для браузера, а внешним импортом дескриптор, реэкспортированный из
 * entry компонента, или контроллер режимов библиотеки тянули бы granum в
 * рантайм — и SSR с внешними пакетами падал бы без него.
 */
const GRANUM_EXTERNAL = /^@feugene\/granum(?:\/(?!(?:contract|runtime)$).*)?$/
const GRANUM_CONTRACT = '@feugene/granum/contract'
const GRANUM_RUNTIME = '@feugene/granum/runtime'
/** Любая точка входа granum в импортах `dist`. */
const GRANUM_PACKAGE = /^@feugene\/granum(?:\/|$)/
/** Причины данных, у которых нет своей причины провайдера: их ошибка исходника идёт как есть. */
const GENERIC_DATA_REASONS = new Set(['invalid-theme-data', 'token-key-prefix'])

/**
 * Точки входа `./contract` и `./runtime` того granum, что собирает провайдер,
 * и каталог его модулей. Встраивается свой код, а не найденный в
 * `node_modules` провайдера: так `dist` совпадает с `generatedBy` манифеста.
 * Раскладок две — исходники (тесты гоняют плагин из `src`) и собранный пакет
 * (`dist/build.js` рядом с `dist/contract.js`).
 */
function ownContract(): { readonly entry: string, readonly runtime: string, readonly dir: string } {
  for (const [entry, runtime, dir] of [['./contract.js', './runtime.js', './'], ['../contract/index.ts', '../runtime.ts', '../']] as const) {
    const path = fileURLToPath(new URL(entry, import.meta.url))
    if (existsSync(path))
      return { entry: path, runtime: fileURLToPath(new URL(runtime, import.meta.url)), dir: normalizePath(fileURLToPath(new URL(dir, import.meta.url))) }
  }
  throw new Error(`granumProvider: cannot locate the @feugene/granum/contract module next to ${import.meta.url}`)
}

/**
 * Встроенные модули Node — внешние, когда у провайдера есть точка входа для
 * Node: иначе Vite подменил бы их в ней пустой заглушкой.
 */
const NODE_EXTERNAL: readonly (string | RegExp)[] = [/^node:/, ...builtinModules]

/**
 * `external` пользователя плюс правило ядра — в той форме, в какой его задал
 * пользователь. Слиянием конфигов Vite этого не выразить: оно склеивает
 * массивы, и функция превращается в `[fn, RegExp]`, которого rolldown не
 * принимает.
 */
function withGranumExternal(user: Rolldown.InputOptions['external'], nodeBuiltins: boolean): NonNullable<Rolldown.InputOptions['external']> {
  const own: (string | RegExp)[] = nodeBuiltins ? [GRANUM_EXTERNAL, ...NODE_EXTERNAL] : [GRANUM_EXTERNAL]
  if (user === undefined)
    return own
  if (typeof user === 'function')
    return (id, parent, isResolved) => own.some(rule => typeof rule === 'string' ? rule === id : rule.test(id)) || user(id, parent, isResolved)
  return [...(Array.isArray(user) ? user : [user]), ...own]
}

/** Значение `entries`: путь или `{ path, env }`. */
function parseEntry(providerId: string, name: string, value: unknown): { readonly name: string, readonly path: string, readonly env: 'browser' | 'node' } {
  if (typeof value === 'string')
    return { name, path: value, env: 'browser' }
  const entry = value as Partial<GranumProviderEntry> | null
  if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string' || (entry.env !== undefined && entry.env !== 'browser' && entry.env !== 'node'))
    throw new InvalidProviderError(providerId, 'invalid-entry', `entries.${name} must be a path or { path, env? } with env 'browser' or 'node'.`)
  return { name, path: entry.path, env: entry.env ?? 'browser' }
}

/** Id модуля для сверки `transform` с `moduleIds` чанков: без запроса, с прямыми слэшами. */
function moduleKey(id: string): string {
  return normalizePath(id.replace(/[?#].*$/, ''))
}

/**
 * Блок `engine` манифеста. `null/null` пишется ровно тогда, когда
 * артефакт ни от какого словаря не зависит и ни одного не расширяет: ни класса,
 * ни записи safelist, ни модуля правил. Иначе — диалект и отпечаток движка
 * сборки: именно он отфильтровал список классов, и это факт, а не догадка.
 */
function engineBlock(
  engine: GranumEngine,
  module: string | null,
  components: Readonly<Record<string, GranumManifest['components'][string]>>,
): GranumManifest['engine'] {
  const usesVocabulary = module !== null
    || Object.values(components).some(c => c.classes.length > 0 || c.safelist.length > 0)
  return {
    dialect: usesVocabulary ? engine.dialect : null,
    vocabulary: usesVocabulary ? engine.vocabulary : null,
    name: engine.name,
    ...(engine.version !== undefined ? { version: engine.version } : {}),
    module,
  }
}

export function granumProvider(options: GranumProviderPluginOptions): Plugin {
  const provider = options.provider
  validateProvider(provider)
  const engine: GranumEngine = options.engine
  if (typeof engine?.generate !== 'function' || typeof engine.dialect !== 'string') {
    throw new InvalidProviderError(
      provider.id,
      'invalid-dialect',
      `granumProvider({ engine }) requires a GranumEngine instance (e.g. windEngine() from '@feugene/granum-engine-wind').`,
    )
  }
  // Утверждение провайдера о словаре сверяется до первой генерации: записать в
  // манифест чужой диалект нельзя.
  const declaredDialect = provider.engine?.dialect
  if (declaredDialect !== undefined && declaredDialect !== engine.dialect)
    throw new EngineDialectMismatchError(provider.id, declaredDialect, engine.dialect, engine.name)
  /*
   * Пути темы и модуля правил уезжают в манифест, а читатель принимает только
   * относительный путь внутри пакета без `./` и `..`. Автор
   * пишет `./theme/tokens.css` — путь нормализуется здесь, один раз. Путь вне
   * пакета — ошибка сейчас, а не у каждого приложения-потребителя.
   */
  const packagePath = (path: string, at: string): string => {
    const normalized = normalizePackagePath(path)
    if (normalized === undefined)
      throw new InvalidProviderError(provider.id, 'path-escapes-package', `${at} '${path}' must be a relative path inside the package.`)
    return normalized
  }
  const themePaths = {
    tokensCss: provider.theme?.tokensCss !== undefined ? packagePath(provider.theme.tokensCss, 'theme.tokensCss') : undefined,
    baseCss: provider.theme?.baseCss !== undefined ? packagePath(provider.theme.baseCss, 'theme.baseCss') : undefined,
    registry: provider.theme?.registry !== undefined ? packagePath(provider.theme.registry, 'theme.registry') : undefined,
    catalog: Object.fromEntries(Object.entries(provider.theme?.catalog ?? {}).map(([id, entry]): [string, CatalogPath] => {
      if ('source' in entry) {
        const source = packagePath(entry.source, `theme.catalog.${id}.source`).replace(/\/+$/, '')
        return [id, { kind: 'source', source, ignore: entry.ignore ?? [], data: `${source}.json` }]
      }
      return [id, { kind: 'data', data: packagePath(entry.data, `theme.catalog.${id}.data`) }]
    })),
  }
  const writtenBy = new Map<string, string>()
  for (const [id, path] of Object.entries(themePaths.catalog)) {
    const other = writtenBy.get(path.data)
    if (other !== undefined)
      throw new InvalidProviderError(provider.id, 'invalid-theme-data', `catalog themes '${other}' and '${id}' write the same file '${path.data}' to dist.`)
    writtenBy.set(path.data, id)
  }
  const engineModule = options.engineModule ? packagePath(options.engineModule, 'engineModule') : null
  const log = options.log ?? ((line: string) => process.stdout.write(`[granum] ${line}\n`))
  const manifestFile = options.manifestFile ?? MANIFEST_FILE_NAME

  let root = process.cwd()
  let outDir = resolve(root, 'dist')
  let hasIndex = false
  let analysis: BundleAnalysis | undefined
  /** Нарушения границы, замеченные на графе модулей: Vite подменяет `node:*` в браузерной сборке заглушкой, и в выводе их уже нет. */
  let graphViolations: { readonly violation: BoundaryViolation, readonly module: string }[] = []
  /** Модули, до которых доходят только точки входа для Node: их нарушения границы не считаются. */
  let nodeOnly = new Set<string>()
  const extraEntries = Object.entries(options.entries ?? {}).map(([name, value]) => parseEntry(provider.id, name, value))
  const nodeEntryFiles = new Set(extraEntries.filter(entry => entry.env === 'node').map(entry => `${entry.name}.js`))
  /** Точки входа granum, оставшиеся внешними в `dist`. */
  let granumImports: string[] = []
  const contract = ownContract()

  const sources = (): ComponentSourceEntry[] => provider.components.map((descriptor) => {
    const source = collectComponentSources([descriptor])[0]
    if (!source) {
      throw new InvalidProviderError(
        provider.id,
        'missing-source-url',
        `descriptor of '${descriptor.name}' has no sourceUrl — create it with defineGranumComponent(import.meta.url, …).`,
        descriptor.name,
      )
    }
    const entry = ['index.ts', 'index.js', 'index.mts', 'index.mjs'].map(f => join(source.dir, f)).find(f => existsSync(f))
    if (!entry) {
      throw new InvalidProviderError(
        provider.id,
        'missing-component-entry',
        `component '${descriptor.name}' has no index.ts next to its config (${source.dir}).`,
        descriptor.name,
      )
    }
    return { descriptor, dir: source.dir, entry }
  })

  return {
    name: 'granum:provider',
    apply: 'build',

    config(userConfig: UserConfig): UserConfig {
      root = resolve(userConfig.root ?? process.cwd())
      const componentSources = collectComponentSources(provider.components)
      const entry: Record<string, string> = {}

      const indexEntry = options.indexEntry === undefined ? 'src/index.ts' : options.indexEntry
      if (indexEntry !== false) {
        const indexPath = resolve(root, indexEntry)
        if (existsSync(indexPath)) {
          entry.index = indexPath
          hasIndex = true
        }
      }
      for (const { descriptor, entry: file } of sources())
        entry[`components/${descriptor.name}/index`] = file
      for (const { name, path } of extraEntries)
        entry[name] = resolve(root, path)

      return {
        build: {
          cssCodeSplit: true,
          lib: {
            entry,
            formats: ['es'],
            fileName: (_format, entryName) => `${entryName}.js`,
          },
          rolldownOptions: {
            output: {
              chunkFileNames: granumChunkFileNames(componentSources),
              // Контракт — отдельным чанком при любой селекции и в `--watch`:
              // строки его сообщений не должны смешаться с кодом компонента.
              // Приоритет — выше групп пользователя: `vendor` по node_modules иначе
              // забрал бы контракт опубликованного granum в общий чанк.
              codeSplitting: { groups: [{ name: GRANUM_CONTRACT_CHUNK, priority: 1_000_000, test: (id: string) => normalizePath(id).startsWith(contract.dir) }] },
              assetFileNames: granumAssetFileNames(componentSources),
            },
          },
        },
      }
    },

    // Свои контракт и рантайм — раньше `vite:resolve`: тот нашёл бы granum в
    // `node_modules` провайдера, а его может и не быть.
    resolveId: {
      order: 'pre',
      handler(source) {
        if (source === GRANUM_CONTRACT)
          return contract.entry
        return source === GRANUM_RUNTIME ? contract.runtime : null
      },
    },

    // Опции rolldown — уже после слияния конфигов: `external` здесь в той
    // форме, в какой его задал пользователь (см. `withGranumExternal`).
    options(input) {
      return { ...input, external: withGranumExternal(input.external, nodeEntryFiles.size > 0) }
    },

    configResolved(config: ResolvedConfig): void {
      root = config.root
      outDir = resolve(root, config.build.outDir)
    },

    /*
     * Состояние сбрасывается здесь, а не в `configResolved`: в `vite build
     * --watch` тот вызывается один раз на сессию, а `transform` при пересборке
     * идёт только по изменённым модулям. Нарушения границы от прошлой сборки
     * иначе копились бы и продолжали ронять сборку после починки кода.
     */
    buildStart(): void {
      graphViolations = []
      nodeOnly = new Set()
      analysis = undefined
      granumImports = []
      // Части составных компонентов выводятся из `exports`: `codegen` посреди
      // `vite build --watch` меняет только `package.json`, а модулем сборки он не
      // является, и без наблюдения манифест остался бы от прежнего `exports`.
      this.addWatchFile(join(root, 'package.json'))
    },

    // Граница ловится на исходном коде модулей: `vite:resolve` подменяет `node:*`
    // заглушкой раньше любого пользовательского `resolveId`, а в выводе импорта
    // уже нет. В тексте модуля спецификатор остаётся как есть.
    transform(code, id): null {
      if (id.startsWith('\0') || id.includes('/node_modules/'))
        return null
      for (const specifier of collectImportSpecifiers(code)) {
        const kind = boundaryKind(specifier)
        if (kind)
          graphViolations.push({ violation: { file: relative(root, id.replace(/[?#].*$/, '')), specifier, kind }, module: moduleKey(id) })
      }
      return null
    },

    async generateBundle(_outputOptions, bundle): Promise<void> {
      const typed = bundle as unknown as BundleLike

      // `@apply` в эмитированных стилях SFC раскрывается до записи на диск и ДО
      // анализа: потребление токенов считается по тому CSS, который
      // уедет в `dist`, иначе round-trip по манифесту разошёлся бы.
      for (const [fileName, item] of Object.entries(typed)) {
        if (item.type === 'asset' && fileName.endsWith('.css') && typeof item.source === 'string')
          (item as { source: string }).source = await expandApply(item.source, engine, fileName)
      }

      // Что от granum осталось внешним в `dist`: встроенный контракт сюда не
      // попадает, остальное — рантайм-зависимость пакета.
      granumImports = sortedUnique(Object.values(typed).flatMap(item =>
        item.type === 'chunk' ? [...item.imports, ...item.dynamicImports].filter(spec => GRANUM_PACKAGE.test(spec)) : []))

      if (nodeEntryFiles.size > 0)
        nodeOnly = new Set([...nodeOnlyModules(typed, nodeEntryFiles)].map(moduleKey))

      analysis = await analyzeBundle(typed, provider.components, engine, {
        ...(hasIndex ? { indexEntry: 'index.js' } : {}),
        ...(provider.engine?.rules ? { rules: provider.engine.rules } : {}),
        ...(provider.engine?.variants ? { variants: provider.engine.variants } : {}),
      })
    },

    async closeBundle(): Promise<void> {
      if (!analysis)
        return

      const pkgPath = join(root, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string, exports?: unknown, dependencies?: Record<string, string>, peerDependencies?: Record<string, string>, optionalDependencies?: Record<string, string> }
      // Части составных компонентов: подпути `exports`, что ведут в entry
      // компонента под чужим именем. Нужны и графу ниже, и манифесту; от
      // `exportsCheck` не зависят — это не проверка, а сведения для приложения.
      const fromRoot = (path: string): string => relative(root, path).split(/[\\/]/).join('/')
      const parts = subcomponentsFromExports(pkg.exports, sources().map(({ descriptor, entry }) => ({
        name: descriptor.name,
        entries: [fromRoot(join(outDir, componentEntryFileName(descriptor.name))), fromRoot(entry)],
      })))
      const ownParts = new Map(Object.entries(parts.byOwner).flatMap(([owner, names]) => names.map(name => [name, owner] as const)))

      // Проверки графа и границы — здесь, а не в `generateBundle`: ошибку из
      // хука генерации бандлер заворачивает в свою, а отсюда она доходит до
      // вызывающего как есть.
      // Импорт части донора по её подпути — ребро на владельца: части знает
      // манифест донора. Пакет без манифеста — не провайдер granum или донор не
      // установлен: ребро остаётся как есть. Битый манифест донора — ошибка:
      // молча он превратился бы в «частей нет».
      const donors = new Map<string, ProviderNode | undefined>()
      const ownerOfEdge = (key: string): string => {
        const [providerId, name] = splitComponentKey(key)
        // Свой подпуть, вынесенный во внешние: части — из своих `exports`, а не
        // из манифеста прошлой сборки.
        if (providerId === provider.id) {
          const owner = ownParts.get(name)
          return owner ? `${providerId}:${owner}` : key
        }
        if (!donors.has(providerId)) {
          let donor: ProviderNode | undefined
          try {
            donor = toProviderNode(loadPackageManifest(providerId, root))
          }
          catch (error) {
            if (!(error instanceof ManifestNotFoundError))
              throw error
          }
          donors.set(providerId, donor)
        }
        const donor = donors.get(providerId)
        const owner = donor ? ownerOf(donor, name) : undefined
        return owner ? `${providerId}:${owner.name}` : key
      }
      const undeclared = findUndeclaredEdges(provider.id, provider.components, analysis, ownerOfEdge)
      if (undeclared.length > 0) {
        const error = new UndeclaredDependencyError(provider.id, undeclared)
        if ((options.dependencyCheck ?? 'error') === 'error')
          throw error
        log(`warning: ${error.message}`)
      }

      const browserGraphViolations = graphViolations.filter(item => !nodeOnly.has(item.module)).map(item => item.violation)
      const violations = dedupeViolations([...browserGraphViolations, ...analysis.violations])
      if (violations.length > 0) {
        const error = new BoundaryViolationError(provider.id, violations)
        if ((options.boundaryCheck ?? 'error') === 'error')
          throw error
        log(`warning: ${error.message}`)
      }

      const warnings: GranumManifestWarning[] = []
      /** Сколько записей safelist вычищено как покрытые извлечением — для лога. */
      let safelistRedundantTotal = 0

      /*
       * Правила движка в манифест не встраиваются — он ссылается на модуль,
       * и путь задаёт автор опцией `engineModule`. Провайдер, который
       * объявил `engine`, но опцию не передал, отгрузил бы манифест с
       * `module: null`: свои классы он извлечёт (правила известны сборке), а
       * приложению правила не достанутся, и его CSS молча разойдётся с
       * пакетным. Молчать здесь нельзя.
       */
      const engineContribution = provider.engine
      const hasEngineRules = Boolean(
        engineContribution?.rules?.length
        || engineContribution?.variants?.length
        || engineContribution?.preflights?.length,
      )
      if (hasEngineRules && !options.engineModule) {
        warnings.push({ code: 'engine-module-missing' })
        log(
          `warning: provider declares engine rules but granumProvider({ engineModule }) is not set — `
          + `the manifest ships 'engine.module: null' and applications will not get them`,
        )
      }

      const sourceDir = resolve(root, options.sourceDir ?? 'src')
      const componentSources = new Map(sources().map(s => [s.descriptor.name, s]))

      // 1. Объявленный CSS компонентов — копия из исходников с раскрытым `@apply`.
      const copiedCss = new Map<string, string>()
      for (const { descriptor, dir } of componentSources.values()) {
        const emittedCss = analysis.components.get(descriptor.name)?.cssAssets ?? []
        for (const path of descriptor.cssFiles ?? []) {
          const rel = path.slice(`components/${descriptor.name}/`.length)
          const from = join(dir, rel)
          let css: string
          try {
            css = readFileSync(from, 'utf8')
          }
          catch (cause) {
            throw new CssReadError(provider.id, 'component', descriptor.name, from, { cause })
          }
          const expanded = await expandApply(css, engine, path)
          /*
           * `cssFiles: ['./styles.css']` рядом с `<style>` SFC — раскладка из
           * руководства, и бандлер уже записал стили SFC ровно по этому пути
           * (`granumAssetFileNames`). Перезапись теряла бы их молча, поэтому
           * файл склеивается в порядке списка `css` манифеста: сначала
           * объявленный, затем эмитированный.
           */
          const emitted = emittedCss.includes(path) ? readOut(outDir, path, new Map()) : ''
          const content = emitted ? `${expanded}\n${emitted}` : expanded
          writeOut(outDir, path, content)
          copiedCss.set(path, content)
        }
      }

      // 2. Файлы темы — из зеркального каталога исходников.
      const themeCss = new Map<string, string>()
      const theme = provider.theme
      const copyTheme = (path: string | undefined, section: 'base' | 'tokens', subject: string): void => {
        if (path === undefined)
          return
        const from = join(sourceDir, path)
        let css: string
        try {
          css = readFileSync(from, 'utf8')
        }
        catch (cause) {
          throw new CssReadError(provider.id, section, subject, from, { cause })
        }
        writeOut(outDir, path, css)
        themeCss.set(path, css)
      }
      copyTheme(themePaths.tokensCss, 'tokens', 'tokens')
      copyTheme(themePaths.baseCss, 'base', 'base')
      const declaredByTheme = new Set<string>()
      for (const css of themeCss.values()) {
        for (const decl of scanCssDeclarations(css))
          declaredByTheme.add(`--${decl.token}`)
      }

      // 3. Реестр и каталог: данные тем с разрешённым `extends`, проверенные по реестру.
      let registry: Record<string, TokenNature> | undefined
      if (themePaths.registry !== undefined) {
        registry = readRegistry(provider.id, join(sourceDir, themePaths.registry))
        writeOut(outDir, themePaths.registry, `${JSON.stringify(registry, null, 2)}\n`)
        for (const token of Object.keys(registry))
          declaredByTheme.add(`--${token}`)
      }
      const catalog: Record<string, GranumManifestCatalogEntry> = {}
      const themeData = new Map<string, GranumThemeData>()
      const themeMeta = new Map<string, CatalogMeta>()
      const building: string[] = []
      /** Исходник записи: данные, метаданные и родитель — из записи каталога или theme.json (C-43). */
      const readCatalogEntry = (id: string): { readonly meta: CatalogMeta, readonly patch: ThemePatch } => {
        const path = themePaths.catalog[id]!
        if (path.kind === 'data') {
          const entry = theme!.catalog![id] as GranumThemeCatalogEntry
          const meta: CatalogMeta = {
            title: entry.title,
            ...(entry.description !== undefined ? { description: entry.description } : {}),
            ...(entry.docs !== undefined ? { docs: entry.docs } : {}),
            ...(entry.extends !== undefined ? { extends: entry.extends } : {}),
          }
          return { meta, patch: readThemeDataFile(provider.id, id, join(sourceDir, path.data), { partial: entry.extends !== undefined }) }
        }
        let loaded: GranumAppTheme
        try {
          loaded = loadThemeSource(join(sourceDir, path.source), { ignore: path.ignore })
        }
        catch (cause) {
          // Нарушение C-40/C-41 — ошибка провайдера своей причиной; остальное — ошибка исходника как есть (§14).
          if (cause instanceof ThemeSourceError && cause.dataReason !== undefined && !GENERIC_DATA_REASONS.has(cause.dataReason))
            throw new InvalidProviderError(provider.id, cause.dataReason as InvalidProviderReason, `theme '${id}': ${cause.message}`)
          throw cause
        }
        const { extends: parent, sources: _sources, ...patch } = loaded
        if (patch.id !== id)
          throw new InvalidProviderError(provider.id, 'theme-id-mismatch', `the source of catalog theme '${id}' (${path.source}/theme.json) declares id '${patch.id}'; the id and the catalog key must match.`)
        if (typeof parent === 'object')
          throw new InvalidProviderError(provider.id, 'theme-extends-unknown', `the source of catalog theme '${id}' extends an object; a catalog theme extends a catalog theme by id.`)
        if (parent !== undefined && !Object.hasOwn(theme!.catalog!, parent))
          throw new InvalidProviderError(provider.id, 'theme-extends-unknown', `theme '${id}' extends '${parent}', which is not in the catalog.`)
        const meta: CatalogMeta = {
          title: patch.title,
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.docs !== undefined ? { docs: patch.docs } : {}),
          ...(parent !== undefined ? { extends: parent } : {}),
        }
        return { meta, patch }
      }
      const buildTheme = (id: string): GranumThemeData => {
        const done = themeData.get(id)
        if (done)
          return done
        if (building.includes(id))
          throw new InvalidProviderError(provider.id, 'theme-extends-unknown', `catalog themes extend each other in a cycle: ${[...building, id].join(' -> ')}.`)
        building.push(id)
        const { meta, patch } = readCatalogEntry(id)
        themeMeta.set(id, meta)
        const identity = {
          id,
          title: meta.title,
          ...(meta.description !== undefined ? { description: meta.description } : {}),
          ...(meta.docs !== undefined ? { docs: meta.docs } : {}),
        }
        // Без родителя исходник обязан быть полным: форму проверит `checkThemeData` ниже.
        const data = meta.extends !== undefined
          ? mergeThemePatch(buildTheme(meta.extends), patch, identity)
          : { ...patch, ...identity } as GranumThemeData
        building.pop()
        const issue = checkThemeData(data)
        if (issue)
          throw themeDataError(provider.id, id, issue)
        if (registry) {
          const missing = missingRegistryTokens(data, registry)
          if (missing.length > 0) {
            throw new InvalidProviderError(
              provider.id,
              'theme-incomplete',
              `theme '${id}' misses ${missing.length} registry token(s): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ', …' : ''}.`,
              undefined,
              missing,
            )
          }
        }
        themeData.set(id, data)
        return data
      }
      for (const id of Object.keys(themePaths.catalog).sort()) {
        const data = buildTheme(id)
        const meta = themeMeta.get(id)!
        const dataPath = themePaths.catalog[id]!.data
        // Значения раздела — ещё и слитыми: читатель до 3.10 раздела не знает (C-44).
        writeOut(outDir, dataPath, `${JSON.stringify(flattenThemeComponents(data), null, 2)}\n`)
        for (const token of themeTokenNames(data))
          declaredByTheme.add(`--${token}`)
        catalog[id] = {
          ...meta,
          data: dataPath,
          modes: themeModeOrder(data),
          defaultMode: data.defaultMode ?? DEFAULT_MODE,
          ...(data.version !== undefined ? { version: data.version } : {}),
          ...(data.targets !== undefined ? { targets: data.targets } : {}),
        }
      }

      // 4. Компоненты.
      const components: Record<string, GranumManifest['components'][string]> = {}
      for (const descriptor of provider.components) {
        const info = analysis.components.get(descriptor.name)
        if (!info || !info.files.includes(componentEntryFileName(descriptor.name))) {
          throw new InvalidProviderError(
            provider.id,
            'missing-component-entry',
            `bundle has no '${componentEntryFileName(descriptor.name)}' for component '${descriptor.name}'.`,
            descriptor.name,
          )
        }
        const declaredCss = descriptor.cssFiles ?? []
        const css = [...declaredCss, ...info.cssAssets.filter(a => !declaredCss.includes(a))]
        const consumes = new Set(info.consumes)
        const requires = new Set(info.requires)
        const assigns = new Set(info.assigns)
        const uses = new Set(info.uses)
        for (const path of declaredCss) {
          const scan = scanTokenConsumption(copiedCss.get(path) ?? '', path)
          for (const name of scan.uses.keys()) {
            consumes.add(`--${name}`)
            uses.add(`--${name}`)
          }
          for (const name of scan.required)
            requires.add(`--${name}`)
          for (const name of scan.assigns)
            assigns.add(`--${name}`)
        }
        const declaredSafelist = sortedUnique(descriptor.safelist ?? [])
        // Классы safelist — такой же источник требований: `bg-[var(--x)]` ждёт
        // значения извне, `bg-[var(--x,red)]` нет.
        for (const klass of declaredSafelist) {
          for (const name of extractRequiredTokenUses(klass))
            requires.add(`--${name}`)
        }
        // Присваивание закрывает требование независимо от того, где оно стоит:
        // в чанке компонента, в объявленном `cssFiles` или в инлайн-стиле.
        for (const token of assigns)
          requires.delete(token)
        /*
         * Запись safelist, которую извлечение и так нашло, в манифест не едет.
         *
         * Она не даёт ни байта CSS (класс уже в `classes`), но раздувает
         * манифест: на дизайн-системе это 3479 записей из 3479. Убирать их в
         * исходнике нельзя и незачем: safelist там выводится из тех же
         * константных классов, что использует компонент, а видит ли их
         * извлечение — решает раскладка чанков бандлером, а не автор. Автор
         * объявил «эти классы собираются в рантайме» и не соврал; совпадение
         * обнаруживается на сборке, значит сборке и решать.
         *
         * Предупреждения здесь поэтому нет: оно винило автора за чужое решение.
         * Число вычищенных печатается строкой лога и уезжает в манифест.
         */
        const redundant = declaredSafelist.filter(c => info.classes.includes(c))
        const safelist = declaredSafelist.filter(c => !info.classes.includes(c))
        safelistRedundantTotal += redundant.length
        /*
         * Двойная доставка ищется в двух местах, и оба нужны.
         *
         * `info.cssImportedByChunk` — свидетельство из объекта бандла: чанк
         * ссылался на свой CSS уже на `generateBundle`. `cssImportedOnDisk` —
         * по записанным файлам: плагины с `enforce: 'post'` вшивают импорт
         * позже нашего хука, и в бандле его на тот момент не видно.
         */
        const importedOnDisk = cssImportedOnDisk(outDir, info.files, css, copiedCss)
        const doubleDelivered = sortedUnique([...info.cssImportedByChunk, ...importedOnDisk])
        if (doubleDelivered.length > 0)
          warnings.push({ code: 'css-double-delivery', component: descriptor.name, files: doubleDelivered })

        const digest = createHash('sha256')
        for (const file of [...info.files, ...css].sort())
          digest.update(file).update(readOut(outDir, file, copiedCss))

        let themes: Record<string, GranumComponentThemeTokens> | undefined
        if (descriptor.themesDir !== undefined) {
          const source = componentSources.get(descriptor.name)!
          themes = readComponentThemesDir(provider.id, descriptor.name, join(source.dir, descriptor.themesDir.slice(`components/${descriptor.name}/`.length)))
        }

        components[descriptor.name] = {
          entry: componentEntryFileName(descriptor.name),
          files: info.files,
          css,
          group: descriptor.group ?? null,
          dependencies: sortedUnique((descriptor.dependencies ?? []).flatMap(dep => normalizeDependencyKeys(dep, provider.id))),
          classes: info.classes,
          safelist,
          tokens: {
            ...(themes !== undefined && Object.keys(themes).length > 0 ? { themes } : {}),
            consumes: sortedUnique(consumes),
            requires: sortedUnique(requires),
            optional: fallbackOnlyTokens(uses, requires, assigns, new Set(info.literals)),
            hooks: sortedUnique((descriptor.hookTokens ?? []).map(t => (t.startsWith('--') ? t : `--${t}`))),
            dynamic: sortedUnique((descriptor.dynamicTokens ?? []).map(t => (t.startsWith('--') ? t : `--${t}`))),
          },
          hash: `sha256-${digest.digest('hex')}`,
        }
      }

      // 5. exports пакета.
      if ((options.exportsCheck ?? 'error') !== 'off') {
        const required = [`./${manifestFile}`, ...provider.components.map(c => `./components/${c.name}`)]
        // `exports` строкой или массивом — один корневой subpath, подпутей в нём нет.
        const subpaths = typeof pkg.exports === 'object' && pkg.exports !== null && !Array.isArray(pkg.exports) ? pkg.exports : {}
        const missing = required.filter(key => !(key in subpaths))
        if (missing.length > 0) {
          const error = new PackageExportsError(provider.id, missing)
          if (options.exportsCheck === 'warn')
            log(`warning: ${error.message}`)
          else
            throw error
        }
      }

      // 5a. Части составных компонентов — в записи владельцев.
      for (const name of parts.ambiguous)
        log(`warning: exports './components/${name}' leads to the entries of several components — it is not recorded as a part of any`)
      for (const [owner, names] of Object.entries(parts.byOwner)) {
        const record = components[owner]
        if (record)
          components[owner] = { ...record, subcomponents: names }
      }

      // 5b. Кросс-провайдерные доноры без peerDependencies и granum, если `dist`
      // импортирует его в рантайме.
      for (const donor of findMissingPeers(provider, pkg, granumImports.length > 0 ? ['@feugene/granum'] : []))
        warnings.push({ code: 'peer-missing', provider: donor })

      // 6. Манифест.
      const dependencyIds = sortedUnique((provider.dependencies ?? []).map(d => (typeof d === 'string' ? d : d.id)))
      writeManifestSync(join(outDir, manifestFile), {
        granum: GRANUM_MANIFEST_VERSION,
        contractVersion: GRANUM_CONTRACT_VERSION,
        id: provider.id,
        version: pkg.version ?? '0.0.0',
        generatedBy: `@feugene/granum@${GRANUM_VERSION}`,
        dependencies: dependencyIds,
        theme: {
          ...(themePaths.tokensCss !== undefined ? { tokensCss: themePaths.tokensCss } : {}),
          ...(themePaths.baseCss !== undefined ? { baseCss: themePaths.baseCss } : {}),
          ...(themePaths.registry !== undefined ? { registry: themePaths.registry } : {}),
          ...(theme?.defaultTheme !== undefined ? { defaultTheme: theme.defaultTheme } : {}),
          ...(Object.keys(catalog).length > 0 ? { catalog } : {}),
          declares: sortedUnique(declaredByTheme),
        },
        engine: engineBlock(engine, engineModule, components),
        components,
        warnings: warnings.sort((a, b) => `${a.code}\0${a.component ?? ''}`.localeCompare(`${b.code}\0${b.component ?? ''}`, 'en')),
      })

      const totalClasses = Object.values(components).reduce((n, c) => n + c.classes.length, 0)
      const totalSafelist = Object.values(components).reduce((n, c) => n + c.safelist.length, 0)
      log(
        `${provider.id}: ${Object.keys(components).length} components, ${totalClasses} classes, `
        + `${totalSafelist} safelist`
        + `${safelistRedundantTotal > 0 ? ` (+${safelistRedundantTotal} covered statically, dropped)` : ''}, `
        + `${warnings.length} warnings → ${relative(root, join(outDir, manifestFile))}`,
      )
    },
  }
}

const NODE_BUILTINS = new Set(builtinModules)

function boundaryKind(source: string): BoundaryViolation['kind'] | undefined {
  if (source.startsWith('node:') || NODE_BUILTINS.has(source))
    return 'node-import'
  if (/^@feugene\/granum\/(?:build|vite|node|codegen)(?:\/|$)/.test(source))
    return 'granum-node-entry'
  return undefined
}

function dedupeViolations(items: readonly BoundaryViolation[]): BoundaryViolation[] {
  const seen = new Set<string>()
  const out: BoundaryViolation[] = []
  for (const v of items) {
    const key = `${v.file}\0${v.specifier}\0${v.kind}`
    if (seen.has(key))
      continue
    seen.add(key)
    out.push(v)
  }
  return out.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.specifier.localeCompare(b.specifier, 'en'))
}

function normalizeDependencyKeys(dep: GranumComponentDescriptor['dependencies'] extends readonly (infer T)[] | undefined ? T : never, providerId: string): string[] {
  if (typeof dep === 'string')
    return dep.includes(':') ? [dep] : [dep]
  return dep.components.map(name => (dep.provider === providerId ? name : `${dep.provider}:${name}`))
}

function writeOut(outDir: string, path: string, content: string): void {
  const dest = resolve(outDir, path)
  if (relative(outDir, dest).startsWith('..'))
    throw new Error(`granum: '${path}' escapes the output directory`)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, content)
}

/**
 * Чанки компонента, которые в ЗАПИСАННОМ виде импортируют свой же CSS-ассет.
 *
 * Почему по диску, а не по объекту бандла. `analyzeBundle` работает в
 * `generateBundle`, а плагины, вшивающие CSS в чанк, объявляют себя
 * `enforce: 'post'` — Vite сортирует pre → normal → post, и их `generateBundle`
 * идёт после нашего независимо от порядка в массиве плагинов. В `chunk.code`
 * на тот момент импорта ещё нет, и увидеть его оттуда нельзя никаким сравнением
 * строк. Ровно так `css-double-delivery` молчал на двух опубликованных
 * пакетах экосистемы — двойную доставку не охраняло ничто.
 *
 * `closeBundle` вызывается после всех `generateBundle`, файлы уже на диске —
 * значит видно то, что реально уедет потребителю.
 *
 * Совпадение ищется только в формах ИМПОРТА, а не в любом строковом литерале:
 * специфкатор бывает `'./styles.css'`, `'../styles.css'`, `'styles.css'` и без
 * пробела после `import` у минифицированного вывода. Литерал сам по себе не
 * подходит: в чанке лежит и скомпилированный конфиг компонента со строкой
 * `cssFiles: ["./styles.css"]` — на нём первая редакция этой проверки дала
 * ложное срабатывание на собственной фикстуре репозитория.
 */
function cssImportedOnDisk(
  outDir: string,
  files: readonly string[],
  cssAssets: readonly string[],
  copied: ReadonlyMap<string, string>,
): string[] {
  if (cssAssets.length === 0)
    return []

  const names = cssAssets.map(asset => asset.slice(asset.lastIndexOf('/') + 1))
  const found: string[] = []

  for (const file of files) {
    if (!file.endsWith('.js'))
      continue
    const code = readOut(outDir, file, copied)
    if (!code)
      continue
    if (names.some(name => importsSpecifier(code, name)))
      found.push(file)
  }
  return found
}

/** Импортирует ли код специфкатор, оканчивающийся на это имя файла. */
function importsSpecifier(code: string, name: string): boolean {
  const spec = `['"\`][^'"\`]*${escapeRegExp(name)}['"\`]`
  return new RegExp(`(?:^|[^\\w$])import\\s*\\(?\\s*${spec}`).test(code)
    || new RegExp(`require\\s*\\(\\s*${spec}`).test(code)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readOut(outDir: string, file: string, copied: ReadonlyMap<string, string>): string {
  const inMemory = copied.get(file)
  if (inMemory !== undefined)
    return inMemory
  try {
    return readFileSync(resolve(outDir, file), 'utf8')
  }
  catch {
    return ''
  }
}
