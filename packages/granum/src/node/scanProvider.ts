/**
 * Медленный путь для провайдера объектной формы: пакет без манифеста,
 * но с раскладкой `dist` по `baseUrl`. Приложение само проходит по файлам
 * компонентов, извлекает классы экстрактором движка (оставляя только те, для
 * которых есть правило), собирает потребление токенов и объявления темы — и
 * получает синтетический манифест, с которым всё ядро ниже работает как с
 * обычным. Это дороже манифеста от `granumProvider()` и без графа бандлера:
 * рёбра между компонентами не проверяются, safelist не сверяется с бандлом.
 */
import type { GranumComponentDescriptor, GranumLoadedManifest, GranumManifest, GranumManifestComponent, GranumManifestWarning, GranumProvider } from '../contract'
import type { GranumEngine } from '../engine/types'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GRANUM_CONTRACT_VERSION, GRANUM_MANIFEST_VERSION } from '../contract'
import { sortedUnique } from '../core/dedupe'
import { SCANNED_MANIFEST_WARNING } from '../core/providerNode'
import { themeTokenNames } from '../core/themeData'
import { GRANUM_VERSION } from '../version'
import { scanCssDeclarations } from './cssDeclarations'
import { objectRulesAllowed } from './dialects'
import { collectImportSpecifiers } from './imports'
import { computeManifestHash } from './manifest'
import { packageSubcomponents } from './subcomponents'
import { componentThemesDirPath, readComponentThemesDir, readObjectCatalog } from './themeFiles'
import { extractRequiredTokenUses, fallbackOnlyTokens, scanTokenConsumption } from './tokenScan'

/** Директория раскладки объектного провайдера, если `baseUrl` — существующий `file:`-каталог. */
export function providerDistDir(provider: GranumProvider): string | undefined {
  if (!provider.baseUrl?.startsWith('file:'))
    return undefined
  try {
    // `resolve` снимает завершающий разделитель: `baseUrl` обязан кончаться на
    // `/`, а сравнение путей ниже идёт по префиксу `${distDir}/`.
    const dir = resolve(fileURLToPath(provider.baseUrl))
    return statSync(dir).isDirectory() ? dir : undefined
  }
  catch {
    return undefined
  }
}

function posix(path: string): string {
  return path.split('\\').join('/')
}

function listFiles(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir))
    return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      out.push(...listFiles(path, filter))
    else if (filter(entry.name))
      out.push(path)
  }
  return out.sort()
}

/**
 * Файлы компонента: всё под `components/<Name>/` плюс относительные импорты,
 * ведущие в общие чанки (`chunks/`, `groups/<g>/shared/`). Файл из директории
 * ДРУГОГО компонента — ребро графа, а не файл: внутрь не заходим.
 */
function walkComponentFiles(distDir: string, name: string, componentDirs: ReadonlySet<string>): string[] {
  const own = join(distDir, 'components', name)
  const queue = listFiles(own, f => /\.(?:js|mjs)$/.test(f))
  const seen = new Set<string>(queue)
  while (queue.length) {
    const file = queue.pop()!
    let code: string
    try {
      code = readFileSync(file, 'utf8')
    }
    catch {
      continue
    }
    for (const spec of collectImportSpecifiers(code)) {
      if (!spec.startsWith('.'))
        continue
      const target = resolve(dirname(file), spec)
      if (!target.startsWith(`${distDir}/`) && !target.startsWith(`${distDir}\\`))
        continue
      const rel = posix(relative(distDir, target))
      const foreign = [...componentDirs].some(dir => dir !== name && rel.startsWith(`components/${dir}/`))
      if (foreign || seen.has(target) || !existsSync(target))
        continue
      seen.add(target)
      queue.push(target)
    }
  }
  return sortedUnique([...seen].map(f => posix(relative(distDir, f))))
}

function readRel(distDir: string, rel: string): string {
  try {
    return readFileSync(join(distDir, rel), 'utf8')
  }
  catch {
    return ''
  }
}

function dependencyKeys(descriptor: GranumComponentDescriptor, providerId: string): string[] {
  return sortedUnique((descriptor.dependencies ?? []).flatMap((dep) => {
    if (typeof dep === 'string')
      return [dep.includes(':') ? dep : `${providerId}:${dep}`]
    return dep.components.map(n => `${dep.provider}:${n}`)
  }))
}

/**
 * Синтетический манифест по `dist` объектного провайдера. `undefined`, если
 * `baseUrl` не указывает на существующий каталог — тогда остаётся объектная
 * форма с предупреждением `provider-without-manifest`.
 */
export async function scanObjectProvider(provider: GranumProvider, engine: GranumEngine): Promise<GranumLoadedManifest | undefined> {
  const distDir = providerDistDir(provider)
  if (distDir === undefined)
    return undefined
  const componentDirs = new Set(provider.components.map(c => c.name))
  const warnings: GranumManifestWarning[] = [{ code: SCANNED_MANIFEST_WARNING }]
  const components: Record<string, GranumManifestComponent> = {}

  for (const descriptor of provider.components) {
    const files = walkComponentFiles(distDir, descriptor.name, componentDirs)
    const candidates = new Set<string>()
    const consumes = new Set<string>()
    const required = new Set<string>()
    const assigns = new Set<string>()
    const uses = new Set<string>()
    const literals = new Set<string>()
    for (const file of files) {
      const code = readRel(distDir, file)
      for (const token of engine.extract(code, file))
        candidates.add(token)
      const scan = scanTokenConsumption(code, file)
      for (const n of scan.uses.keys()) {
        consumes.add(`--${n}`)
        uses.add(`--${n}`)
      }
      for (const n of scan.literals) {
        consumes.add(`--${n}`)
        literals.add(`--${n}`)
      }
      for (const n of scan.required)
        required.add(`--${n}`)
      for (const n of scan.assigns)
        assigns.add(`--${n}`)
    }
    const declaredCss = descriptor.cssFiles ?? []
    const ownCss = listFiles(join(distDir, 'components', descriptor.name), f => f.endsWith('.css')).map(f => posix(relative(distDir, f)))
    const css = sortedUnique([...declaredCss, ...ownCss])
    for (const path of css) {
      const scan = scanTokenConsumption(readRel(distDir, path), path)
      for (const n of scan.uses.keys()) {
        consumes.add(`--${n}`)
        uses.add(`--${n}`)
      }
      for (const n of scan.required)
        required.add(`--${n}`)
      for (const n of scan.assigns)
        assigns.add(`--${n}`)
    }
    // Правила пакета исполняются только движком объявленного словаря:
    // чужой диалект — классы считаются без них, и они окажутся
    // в `unmatched`, а не молча выпадут.
    const rulesAllowed = objectRulesAllowed(provider, engine)
    const generated = await engine.generate({
      classes: candidates,
      ...(rulesAllowed && provider.engine?.rules ? { rules: provider.engine.rules } : {}),
      ...(rulesAllowed && provider.engine?.variants ? { variants: provider.engine.variants } : {}),
    })
    const classes = sortedUnique(generated.matched.keys())
    const declaredSafelist = sortedUnique(descriptor.safelist ?? [])
    for (const klass of declaredSafelist) {
      for (const name of extractRequiredTokenUses(klass))
        required.add(`--${name}`)
    }
    // Как и на сборке провайдера: запись, которую извлечение и так нашло, в
    // резолюцию не едет. CSS от этого не меняется, а манифест не раздувается.
    const safelist = declaredSafelist.filter(c => !classes.includes(c))
    const digest = createHash('sha256')
    for (const file of [...files, ...css].sort())
      digest.update(file).update(readRel(distDir, file))
    components[descriptor.name] = {
      entry: `components/${descriptor.name}/index.js`,
      files,
      css,
      group: descriptor.group ?? null,
      dependencies: dependencyKeys(descriptor, provider.id),
      classes,
      safelist,
      tokens: {
        ...themesOf(provider.id, descriptor, distDir),
        consumes: sortedUnique(consumes),
        requires: sortedUnique([...required].filter(t => !assigns.has(t))),
        optional: fallbackOnlyTokens(uses, required, assigns, literals),
        hooks: sortedUnique((descriptor.hookTokens ?? []).map(t => (t.startsWith('--') ? t : `--${t}`))),
        dynamic: sortedUnique((descriptor.dynamicTokens ?? []).map(t => (t.startsWith('--') ? t : `--${t}`))),
      },
      hash: `sha256-${digest.digest('hex')}`,
    }
  }

  // Части составных компонентов — как их записала бы сборка провайдера.
  for (const [owner, parts] of Object.entries(packageSubcomponents(distDir, provider.id, provider.components.map(c => c.name)))) {
    const record = components[owner]
    if (record)
      components[owner] = { ...record, subcomponents: parts }
  }

  const theme = provider.theme
  const declares = new Set<string>()
  for (const rel of [theme?.tokensCss, theme?.baseCss]) {
    if (rel === undefined)
      continue
    for (const decl of scanCssDeclarations(readRel(distDir, rel)))
      declares.add(`--${decl.token}`)
  }
  // Индекс режимов взять негде, кроме самих данных: медленный путь читает все
  // темы каталога. Он и так читает пакет целиком, а сборка провайдера — нет.
  const catalog = readObjectCatalog(provider, distDir, (data) => {
    for (const token of themeTokenNames(data))
      declares.add(`--${token}`)
  })

  const usesVocabulary = Object.values(components).some(c => c.classes.length > 0 || c.safelist.length > 0)
  const body: Omit<GranumManifest, 'hash'> = {
    granum: GRANUM_MANIFEST_VERSION,
    contractVersion: GRANUM_CONTRACT_VERSION,
    id: provider.id,
    version: '0.0.0',
    generatedBy: `@feugene/granum@${GRANUM_VERSION} (scanned)`,
    dependencies: sortedUnique((provider.dependencies ?? []).map(d => (typeof d === 'string' ? d : d.id))),
    theme: {
      ...(theme?.tokensCss !== undefined ? { tokensCss: theme.tokensCss } : {}),
      ...(theme?.baseCss !== undefined ? { baseCss: theme.baseCss } : {}),
      ...(theme?.registry !== undefined ? { registry: theme.registry } : {}),
      ...(theme?.defaultTheme !== undefined ? { defaultTheme: theme.defaultTheme } : {}),
      ...(Object.keys(catalog).length > 0 ? { catalog } : {}),
      declares: sortedUnique(declares),
    },
    engine: {
      // Классы просканированного пакета отфильтровал движок ПРИЛОЖЕНИЯ здесь и
      // сейчас — значит, его диалект и отпечаток и есть факт о списке.
      dialect: usesVocabulary ? engine.dialect : null,
      vocabulary: usesVocabulary ? engine.vocabulary : null,
      name: engine.name,
      ...(engine.version !== undefined ? { version: engine.version } : {}),
      module: null,
    },
    components,
    warnings,
  }
  const manifest: GranumManifest = { ...body, hash: '' }
  return { manifest: { ...manifest, hash: computeManifestHash(manifest) }, baseUrl: provider.baseUrl! }
}

/** Токены компонента по темам: папка `themesDir` от `config.ts` или от раскладки. */
function themesOf(providerId: string, descriptor: GranumComponentDescriptor, distDir: string): Pick<GranumManifestComponent['tokens'], 'themes'> {
  const dir = componentThemesDirPath(descriptor, distDir)
  if (dir === undefined)
    return {}
  const themes = readComponentThemesDir(providerId, descriptor.name, dir)
  return Object.keys(themes).length > 0 ? { themes } : {}
}

/** Инстансы-доноры объектного провайдера (транзитивно): с манифестной формой их надо подать в резолвер отдельно. */
export function collectProviderInstances(provider: GranumProvider, into: Map<string, GranumProvider> = new Map()): Map<string, GranumProvider> {
  for (const dep of provider.dependencies ?? []) {
    if (typeof dep === 'string' || into.has(dep.id))
      continue
    into.set(dep.id, dep)
    collectProviderInstances(dep, into)
  }
  return into
}
