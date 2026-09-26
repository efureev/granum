/**
 * Плагин сборки провайдера `granumProvider()` (ТЗ §6). Один плагин вместо трёх
 * хелперов v1 и ручного списка entry: строит entry по реестру компонентов,
 * раскладывает чанки и CSS по контракту, извлекает классы и токены по графу
 * бандла, копирует объявленный CSS, раскрывает `@apply`, проверяет границу
 * browser/node и пишет `granum.manifest.json`.
 */
import type { Plugin, ResolvedConfig, UserConfig } from 'vite'
import type { GranumComponentDescriptor, GranumManifest, GranumManifestWarning, GranumProvider } from '../contract'
import type { CreateEngineOptions, GranumEngine } from '../engine/types'
import type { BoundaryViolation, BundleAnalysis, BundleLike } from './graph'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { validateProvider } from '../contract/validate'
import { sortedUnique } from '../core/dedupe'
import { BoundaryViolationError, CssReadError, InvalidProviderError, PackageExportsError, UndeclaredDependencyError } from '../core/errors'
import { createEngine } from '../engine/builtin'
import { scanCssDeclarations } from '../node/cssDeclarations'
import { MANIFEST_FILE_NAME, writeManifestSync } from '../node/manifest'
import { materializeProviderRefs } from '../node/materializeRefs'
import { scanTokenConsumption } from '../node/tokenScan'
import { GRANUM_VERSION } from '../version'
import { expandApply } from './apply'
import { analyzeBundle, findUndeclaredEdges } from './graph'
import { collectComponentSources, componentEntryFileName, granumAssetFileNames, granumChunkFileNames } from './layout'
import { findMissingPeers } from './peers'

export interface GranumProviderPluginOptions {
  /** Объект контракта провайдера — браузерный entry пакета. */
  readonly provider: GranumProvider
  /** Каталог исходников, зеркалящий раскладку `dist` для файлов темы (`src/theme/base.css` ↔ `theme/base.css`). По умолчанию `src`. */
  readonly sourceDir?: string
  /** Корневой entry пакета (`index`). По умолчанию `src/index.ts`, если существует; `false` — не добавлять. */
  readonly indexEntry?: string | false
  /** Дополнительные entry: имя → путь относительно корня пакета. */
  readonly entries?: Readonly<Record<string, string>>
  /** Неучтённое ребро графа компонентов: ошибка (по умолчанию) или предупреждение (B-8). */
  readonly dependencyCheck?: 'error' | 'warn'
  /** Нарушение границы browser/node в бандле (B-16). По умолчанию `error`. */
  readonly boundaryCheck?: 'error' | 'warn'
  /** Проверка `package.json#exports` (B-13). По умолчанию `error`. */
  readonly exportsCheck?: 'error' | 'warn' | 'off'
  readonly engine?: CreateEngineOptions
  /** Модуль с правилами движка провайдера — путь относительно `dist` для манифеста (M-7). */
  readonly engineModule?: string | null
  readonly manifestFile?: string
  /** Дополнительный внешний список для rolldown (`vue` и т.п. провайдер задаёт сам). */
  readonly log?: (line: string) => void
}

interface ComponentSourceEntry {
  readonly descriptor: GranumComponentDescriptor
  readonly dir: string
  readonly entry: string
}

export function granumProvider(options: GranumProviderPluginOptions): Plugin {
  const provider = options.provider
  validateProvider(provider)
  const engine: GranumEngine = createEngine(options.engine)
  const log = options.log ?? ((line: string) => process.stdout.write(`[granum] ${line}\n`))
  const manifestFile = options.manifestFile ?? MANIFEST_FILE_NAME

  let root = process.cwd()
  let outDir = resolve(root, 'dist')
  let hasIndex = false
  let analysis: BundleAnalysis | undefined
  /** Нарушения границы, замеченные на графе модулей (B-16): Vite подменяет `node:*` в браузерной сборке заглушкой, и в выводе их уже нет. */
  let graphViolations: BoundaryViolation[] = []

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
      for (const [name, file] of Object.entries(options.entries ?? {}))
        entry[name] = resolve(root, file)

      return {
        build: {
          cssCodeSplit: true,
          lib: {
            entry,
            formats: ['es'],
            fileName: (_format, entryName) => `${entryName}.js`,
          },
          rolldownOptions: {
            external: [/^@feugene\/granum(?:\/.*)?$/],
            output: {
              chunkFileNames: granumChunkFileNames(componentSources),
              assetFileNames: granumAssetFileNames(componentSources),
            },
          },
        },
      }
    },

    configResolved(config: ResolvedConfig): void {
      root = config.root
      outDir = resolve(root, config.build.outDir)
    },

    /*
     * Состояние сбрасывается здесь, а не в `configResolved`: в `vite build
     * --watch` тот вызывается один раз на сессию, а `transform` при пересборке
     * идёт только по изменённым модулям. Нарушения границы от прошлой сборки
     * иначе копились бы и продолжали ронять сборку после починки кода (B-15).
     */
    buildStart(): void {
      graphViolations = []
      analysis = undefined
    },

    // Граница ловится на исходном коде модулей: `vite:resolve` подменяет `node:*`
    // заглушкой раньше любого пользовательского `resolveId`, а в выводе импорта
    // уже нет. В тексте модуля спецификатор остаётся как есть.
    transform(code, id): null {
      if (id.startsWith('\0') || id.includes('/node_modules/'))
        return null
      for (const specifier of importSpecifiers(code)) {
        const kind = boundaryKind(specifier)
        if (kind)
          graphViolations.push({ file: relative(root, id.replace(/[?#].*$/, '')), specifier, kind })
      }
      return null
    },

    async generateBundle(_outputOptions, bundle): Promise<void> {
      const typed = bundle as unknown as BundleLike

      // `@apply` в эмитированных стилях SFC раскрывается до записи на диск и ДО
      // анализа (B-11): потребление токенов считается по тому CSS, который
      // уедет в `dist`, иначе round-trip по манифесту разошёлся бы (INV-MAN-6).
      for (const [fileName, item] of Object.entries(typed)) {
        if (item.type === 'asset' && fileName.endsWith('.css') && typeof item.source === 'string')
          (item as { source: string }).source = await expandApply(item.source, engine, fileName)
      }

      analysis = await analyzeBundle(typed, provider.components, engine, {
        ...(hasIndex ? { indexEntry: 'index.js' } : {}),
        ...(provider.engine?.rules ? { rules: provider.engine.rules } : {}),
        ...(provider.engine?.variants ? { variants: provider.engine.variants } : {}),
      })
    },

    async closeBundle(): Promise<void> {
      if (!analysis)
        return

      // Проверки графа и границы — здесь, а не в `generateBundle`: ошибку из
      // хука генерации бандлер заворачивает в свою, а отсюда она доходит до
      // вызывающего как есть.
      const undeclared = findUndeclaredEdges(provider.id, provider.components, analysis)
      if (undeclared.length > 0) {
        const error = new UndeclaredDependencyError(provider.id, undeclared)
        if ((options.dependencyCheck ?? 'error') === 'error')
          throw error
        log(`warning: ${error.message}`)
      }

      const violations = dedupeViolations([...graphViolations, ...analysis.violations])
      if (violations.length > 0) {
        const error = new BoundaryViolationError(provider.id, violations)
        if ((options.boundaryCheck ?? 'error') === 'error')
          throw error
        log(`warning: ${error.message}`)
      }

      const warnings: GranumManifestWarning[] = []

      /*
       * Правила движка в манифест не встраиваются — он ссылается на модуль
       * (M-7), и путь задаёт автор опцией `engineModule`. Провайдер, который
       * объявил `engine`, но опцию не передал, отгрузил бы манифест с
       * `engineModule: null`: свои классы он извлечёт (правила известны
       * сборке), а приложению правила не достанутся, и его CSS молча
       * разойдётся с пакетным. Молчать здесь нельзя (INV-DIAG-3).
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
          + `the manifest ships 'engineModule: null' and applications will not get them`,
        )
      }

      const sourceDir = resolve(root, options.sourceDir ?? 'src')
      const componentSources = new Map(sources().map(s => [s.descriptor.name, s]))

      // 1. Объявленный CSS компонентов — копия из исходников с раскрытым `@apply`.
      const copiedCss = new Map<string, string>()
      for (const { descriptor, dir } of componentSources.values()) {
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
          writeOut(outDir, path, expanded)
          copiedCss.set(path, expanded)
        }
      }

      // 2. Файлы темы — из зеркального каталога исходников.
      const themeCss = new Map<string, string>()
      const theme = provider.theme
      const copyTheme = (path: string | undefined, section: 'base' | 'tokens' | 'theme', subject: string): void => {
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
      copyTheme(theme?.tokensCss, 'tokens', 'tokens')
      copyTheme(theme?.baseCss, 'base', 'base')
      for (const [name, path] of Object.entries(theme?.themes ?? {}))
        copyTheme(path, 'theme', name)

      // 3. Ссылки на токены материализуются здесь, один раз (C-13).
      const materialized = materializeProviderRefs(
        provider.baseUrl !== undefined ? provider : { ...provider, baseUrl: `${pathToFileURL(sourceDir).href}/` },
      )
      const declaredByTheme = new Set<string>()
      for (const css of themeCss.values()) {
        for (const decl of scanCssDeclarations(css))
          declaredByTheme.add(`--${decl.token}`)
      }
      for (const set of Object.values(materialized.theme?.tokenDefinitions ?? {})) {
        for (const token of Object.keys(set.tokens))
          declaredByTheme.add(`--${token}`)
      }

      // 4. Компоненты.
      const components: Record<string, GranumManifest['components'][string]> = {}
      for (const descriptor of materialized.components) {
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
        for (const path of declaredCss) {
          for (const name of scanTokenConsumption(copiedCss.get(path) ?? '', path).uses.keys())
            consumes.add(`--${name}`)
        }
        const safelist = sortedUnique(descriptor.safelist ?? [])
        const redundant = safelist.filter(c => info.classes.includes(c))
        if (redundant.length > 0)
          warnings.push({ code: 'safelist-redundant', component: descriptor.name, classes: redundant })
        if (info.cssImportedByChunk.length > 0)
          warnings.push({ code: 'css-double-delivery', component: descriptor.name, files: info.cssImportedByChunk })

        const digest = createHash('sha256')
        for (const file of [...info.files, ...css].sort())
          digest.update(file).update(readOut(outDir, file, copiedCss))

        components[descriptor.name] = {
          entry: componentEntryFileName(descriptor.name),
          files: info.files,
          css,
          group: descriptor.group ?? null,
          dependencies: sortedUnique((descriptor.dependencies ?? []).flatMap(dep => normalizeDependencyKeys(dep, provider.id))),
          classes: info.classes,
          safelist,
          tokens: {
            declares: descriptor.tokenDefinitions ?? {},
            consumes: sortedUnique(consumes),
            dynamic: sortedUnique((descriptor.dynamicTokens ?? []).map(t => (t.startsWith('--') ? t : `--${t}`))),
          },
          hash: `sha256-${digest.digest('hex')}`,
        }
      }

      // 5. exports пакета (B-13).
      const pkgPath = join(root, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string, exports?: Record<string, unknown>, dependencies?: Record<string, string>, peerDependencies?: Record<string, string>, optionalDependencies?: Record<string, string> }
      if ((options.exportsCheck ?? 'error') !== 'off') {
        const required = [`./${manifestFile}`, ...provider.components.map(c => `./components/${c.name}`)]
        const missing = required.filter(key => !(pkg.exports && key in pkg.exports))
        if (missing.length > 0) {
          const error = new PackageExportsError(provider.id, missing)
          if (options.exportsCheck === 'warn')
            log(`warning: ${error.message}`)
          else
            throw error
        }
      }

      // 5b. Кросс-провайдерные доноры без peerDependencies (C-5, INV-CON-9).
      for (const donor of findMissingPeers(provider, pkg))
        warnings.push({ code: 'peer-missing', provider: donor })

      // 6. Манифест.
      const dependencyIds = sortedUnique((provider.dependencies ?? []).map(d => (typeof d === 'string' ? d : d.id)))
      writeManifestSync(join(outDir, manifestFile), {
        granum: 1,
        contractVersion: 1,
        id: provider.id,
        version: pkg.version ?? '0.0.0',
        generatedBy: `@feugene/granum@${GRANUM_VERSION}`,
        dependencies: dependencyIds,
        theme: {
          ...(theme?.tokensCss !== undefined ? { tokensCss: theme.tokensCss } : {}),
          ...(theme?.baseCss !== undefined ? { baseCss: theme.baseCss } : {}),
          themes: theme?.themes ?? {},
          defaultThemes: theme?.defaultThemes ?? [],
          tokenDefinitions: materialized.theme?.tokenDefinitions ?? {},
          declares: sortedUnique(declaredByTheme),
        },
        engineModule: options.engineModule ?? null,
        components,
        warnings: warnings.sort((a, b) => `${a.code}\0${a.component ?? ''}`.localeCompare(`${b.code}\0${b.component ?? ''}`, 'en')),
      })

      const totalClasses = Object.values(components).reduce((n, c) => n + c.classes.length, 0)
      log(
        `${provider.id}: ${Object.keys(components).length} components, ${totalClasses} classes, `
        + `${Object.values(components).reduce((n, c) => n + c.safelist.length, 0)} safelist, `
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

const IMPORT_RES = [
  /\b(?:import|export)\b[^'";]+?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

function importSpecifiers(code: string): Set<string> {
  const out = new Set<string>()
  const source = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
  for (const re of IMPORT_RES) {
    for (const m of source.matchAll(re))
      out.add(m[1]!)
  }
  return out
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
