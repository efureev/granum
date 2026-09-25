/**
 * Медленный путь для провайдера объектной формы (R-6): пакет без манифеста,
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
import { sortedUnique } from '../core/dedupe'
import { GRANUM_VERSION } from '../version'
import { scanCssDeclarations } from './cssDeclarations'
import { collectImportSpecifiers } from './imports'
import { computeManifestHash } from './manifest'
import { scanTokenConsumption } from './tokenScan'

export const SCANNED_MANIFEST_WARNING = 'scanned-provider'

/** Директория раскладки объектного провайдера, если `baseUrl` — существующий `file:`-каталог. */
export function providerDistDir(provider: GranumProvider): string | undefined {
  if (!provider.baseUrl?.startsWith('file:'))
    return undefined
  try {
    // `resolve` снимает завершающий разделитель: `baseUrl` обязан кончаться на
    // `/` (C-6), а сравнение путей ниже идёт по префиксу `${distDir}/`.
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
 * ДРУГОГО компонента — ребро графа, а не файл (B-7): внутрь не заходим.
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
    for (const file of files) {
      const code = readRel(distDir, file)
      for (const token of engine.extract(code, file))
        candidates.add(token)
      const scan = scanTokenConsumption(code, file)
      for (const n of scan.uses.keys())
        consumes.add(`--${n}`)
      for (const n of scan.literals)
        consumes.add(`--${n}`)
    }
    const declaredCss = descriptor.cssFiles ?? []
    const ownCss = listFiles(join(distDir, 'components', descriptor.name), f => f.endsWith('.css')).map(f => posix(relative(distDir, f)))
    const css = sortedUnique([...declaredCss, ...ownCss])
    for (const path of css) {
      for (const n of scanTokenConsumption(readRel(distDir, path), path).uses.keys())
        consumes.add(`--${n}`)
    }
    const generated = await engine.generate({
      classes: candidates,
      ...(provider.engine?.rules ? { rules: provider.engine.rules } : {}),
      ...(provider.engine?.variants ? { variants: provider.engine.variants } : {}),
    })
    const classes = sortedUnique(generated.matched.keys())
    const safelist = sortedUnique(descriptor.safelist ?? [])
    const redundant = safelist.filter(c => classes.includes(c))
    if (redundant.length > 0)
      warnings.push({ code: 'safelist-redundant', component: descriptor.name, classes: redundant })
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
        declares: descriptor.tokenDefinitions ?? {},
        consumes: sortedUnique(consumes),
        dynamic: sortedUnique((descriptor.dynamicTokens ?? []).map(t => (t.startsWith('--') ? t : `--${t}`))),
      },
      hash: `sha256-${digest.digest('hex')}`,
    }
  }

  const theme = provider.theme
  const declares = new Set<string>()
  for (const rel of [theme?.tokensCss, theme?.baseCss, ...Object.values(theme?.themes ?? {})]) {
    if (rel === undefined)
      continue
    for (const decl of scanCssDeclarations(readRel(distDir, rel)))
      declares.add(`--${decl.token}`)
  }
  for (const set of Object.values(theme?.tokenDefinitions ?? {})) {
    for (const t of Object.keys(set.tokens))
      declares.add(`--${t}`)
  }
  for (const component of provider.components) {
    for (const set of Object.values(component.tokenDefinitions ?? {})) {
      for (const t of Object.keys(set.tokens))
        declares.add(`--${t}`)
    }
  }

  const body: Omit<GranumManifest, 'hash'> = {
    granum: 1,
    contractVersion: 1,
    id: provider.id,
    version: '0.0.0',
    generatedBy: `@feugene/granum@${GRANUM_VERSION} (scanned)`,
    dependencies: sortedUnique((provider.dependencies ?? []).map(d => (typeof d === 'string' ? d : d.id))),
    theme: {
      ...(theme?.tokensCss !== undefined ? { tokensCss: theme.tokensCss } : {}),
      ...(theme?.baseCss !== undefined ? { baseCss: theme.baseCss } : {}),
      themes: theme?.themes ?? {},
      defaultThemes: theme?.defaultThemes ?? [],
      tokenDefinitions: theme?.tokenDefinitions ?? {},
      declares: sortedUnique(declares),
    },
    engineModule: null,
    components,
    warnings,
  }
  const manifest: GranumManifest = { ...body, hash: '' }
  return { manifest: { ...manifest, hash: computeManifestHash(manifest) }, baseUrl: provider.baseUrl! }
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
