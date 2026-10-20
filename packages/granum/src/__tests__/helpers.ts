import type { GranumConfig } from '../config'
import type { GranumComponentDescriptor, GranumComponentThemeTokens, GranumLoadedManifest, GranumManifest, GranumManifestComponent, GranumProvider, GranumThemeData } from '../contract'
import type { GranumModesInput } from '../core/resolveThemes'
import type { GranumEngine } from '../engine/types'
import type { PreparedApp } from '../node/prepare'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineGranumProvider } from '../contract'
import { themeModeOrder } from '../core/themeData'
import { prepareApp } from '../node/prepare'
import { testEngine } from './testEngine'

/** Движок тестов один на прогон: его диалект и отпечаток попадают в фикстуры манифестов. */
export const TEST_ENGINE = testEngine()

/**
 * `prepareApp` с движком по умолчанию: движок в конфиге обязателен, а
 * тестам интересен не он, а резолюция. Тест, которому нужен другой словарь,
 * передаёт свой инстанс.
 */
export function prepareTestApp(
  config: Omit<GranumConfig, 'engine'> & { readonly engine?: GranumEngine },
  root: string,
): Promise<PreparedApp> {
  return prepareApp({ ...config, engine: config.engine ?? TEST_ENGINE } as GranumConfig, root)
}

/** Провайдер объектной формы с минимумом полей. */
export function makeProvider(
  id: string,
  patch: Partial<Omit<GranumProvider, 'id' | 'contractVersion'>> = {},
): GranumProvider {
  return defineGranumProvider({
    id,
    contractVersion: 2,
    baseUrl: `file:///${id.replace(/[^\w-]/g, '_')}/`,
    components: [],
    ...patch,
  })
}

export function component(name: string, patch: Partial<GranumComponentDescriptor> = {}): GranumComponentDescriptor {
  return { name, ...patch }
}

/** Манифест с заполненными обязательными полями; `hash` фиктивный — читатель его не видит. */
export function makeManifest(
  id: string,
  components: Record<string, Partial<GranumManifestComponent>> = {},
  patch: Partial<Omit<GranumManifest, 'id' | 'components'>> = {},
): GranumLoadedManifest {
  const manifest: GranumManifest = {
    granum: 3,
    contractVersion: 2,
    id,
    version: '0.0.0',
    generatedBy: '@feugene/granum@test',
    hash: `sha256-${id}`,
    dependencies: [],
    theme: { declares: [] },
    engine: { dialect: TEST_ENGINE.dialect, vocabulary: TEST_ENGINE.vocabulary, name: TEST_ENGINE.name, module: null },
    components: Object.fromEntries(Object.entries(components).map(([name, c]) => [name, {
      entry: `components/${name}/index.js`,
      files: [`components/${name}/index.js`],
      css: [],
      group: null,
      dependencies: [],
      classes: [],
      safelist: [],
      tokens: { consumes: [], dynamic: [] },
      hash: `sha256-${name}`,
      ...c,
    }])),
    warnings: [],
    ...patch,
  }
  return { manifest, baseUrl: `file:///node_modules/${id}/dist/` }
}

/** Данные темы: корень, режимы с цветовой схемой и токенами. */
export function themeData(
  id: string,
  modes: Readonly<Record<string, Readonly<Record<string, string>> | { readonly colorScheme: 'light' | 'dark', readonly tokens: Readonly<Record<string, string>>, readonly extends?: string, readonly fallbacks?: readonly { supports: string, tokens: Record<string, string> }[] }>>,
  patch: Partial<Omit<GranumThemeData, 'id' | 'modes'>> = {},
): GranumThemeData {
  return {
    id,
    title: id[0]!.toUpperCase() + id.slice(1),
    root: {},
    modes: Object.fromEntries(Object.entries(modes).map(([name, mode]) => [
      name,
      'tokens' in mode && typeof mode.tokens === 'object'
        ? mode as GranumThemeData['modes'][string]
        : { colorScheme: name === 'light' ? 'light' as const : 'dark' as const, tokens: mode as Readonly<Record<string, string>> },
    ])),
    ...patch,
  }
}

/** «Бумага»: light и dark, формула в корне и в режиме. */
export const PAPER = themeData('paper', {
  light: { 'p-bg': '#ffffff', 'p-fg': '#111111', 'p-accent': '#2563eb' },
  dark: { 'p-bg': '#000000', 'p-fg': '#eeeeee', 'p-accent': '#60a5fa' },
}, { title: 'Бумага', root: { 'p-radius': '6px', 'p-ring': '0 0 0 2px var(--p-accent)' } })

/** «Чернила» — полные данные, как их кладёт в `dist` сборка; `dim` наследует `dark`. */
export const INK = themeData('ink', {
  light: { 'p-bg': '#ffffff', 'p-fg': '#111111', 'p-accent': '#111827' },
  dark: { 'p-bg': '#000000', 'p-fg': '#eeeeee', 'p-accent': '#60a5fa' },
  dim: { colorScheme: 'dark', extends: 'dark', tokens: { 'p-bg': '#1e293b' } },
}, { title: 'Чернила', root: { 'p-radius': '2px', 'p-ring': '0 0 0 2px var(--p-accent)' } })

/**
 * Владелец каталога на диске: данные тем в `dist/themes/<id>.json`, индекс в
 * манифесте. Компоненты — с токенами по темам, как их материализует сборка.
 */
export function catalogProvider(options: {
  readonly id?: string
  readonly themes?: Readonly<Record<string, GranumThemeData & { readonly extends?: string }>>
  readonly defaultTheme?: string
  readonly components?: Readonly<Record<string, Partial<GranumManifestComponent> & { readonly themes?: Readonly<Record<string, GranumComponentThemeTokens>> }>>
  readonly tokensCss?: string
} = {}): { root: string, dist: string, provider: GranumLoadedManifest } {
  const id = options.id ?? '@p/ds'
  const root = mkdtempSync(join(tmpdir(), 'granum-catalog-'))
  const dist = join(root, `node_modules/${id}/dist`)
  mkdirSync(join(dist, 'themes'), { recursive: true })
  const themes: Readonly<Record<string, GranumThemeData & { readonly extends?: string }>> = options.themes ?? { paper: PAPER, ink: { ...INK, extends: 'paper' } }
  const catalog: Record<string, NonNullable<GranumManifest['theme']['catalog']>[string]> = {}
  for (const [themeId, data] of Object.entries(themes)) {
    const { extends: parent, ...full } = data
    writeFileSync(join(dist, `themes/${themeId}.json`), JSON.stringify(full))
    catalog[themeId] = {
      title: full.title,
      ...(parent !== undefined ? { extends: parent } : {}),
      data: `themes/${themeId}.json`,
      modes: themeModeOrder(full),
      defaultMode: full.defaultMode ?? 'light',
    }
  }
  if (options.tokensCss !== undefined)
    writeFileSync(join(dist, 'tokens.css'), options.tokensCss)
  const components = Object.fromEntries(Object.entries(options.components ?? { Plain: {} }).map(([name, { themes: componentThemes, ...rest }]) => [name, {
    ...rest,
    ...(componentThemes ? { tokens: { themes: componentThemes, consumes: [], dynamic: [], ...rest.tokens } } : {}),
  }]))
  const loaded = makeManifest(id, components, {
    theme: {
      ...(options.tokensCss !== undefined ? { tokensCss: 'tokens.css' } : {}),
      defaultTheme: options.defaultTheme ?? Object.keys(themes)[0]!,
      catalog,
      declares: [],
    },
  })
  return { root, dist, provider: { manifest: loaded.manifest, baseUrl: `${pathToFileURL(dist).href}/` } }
}

/**
 * Все режимы темы и режимы приложения — явным `modes.names`. Без него сборка
 * берёт только режим по умолчанию (A-25), а тестам слоёв и эмиссии нужны все.
 */
export function allModes(theme: GranumThemeData, modes: GranumModesInput = {}): GranumModesInput {
  return modes.names ? modes : { ...modes, names: [...Object.keys(theme.modes), ...Object.keys(modes.define ?? {})] }
}
