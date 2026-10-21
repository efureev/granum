/**
 * Проверки контракта при регистрации. Их вызывают и
 * `defineGranumProvider`, и `expandProviders` — рукописный объект без хелпера
 * проходит те же проверки.
 */
import type { GranumComponentDescriptor, GranumProvider, GranumThemeCatalogEntry, GranumThemeSourceEntry } from './types'
import {
  DuplicateComponentNameError,
  InvalidComponentNameError,
  InvalidProviderError,
  UnsupportedContractVersionError,
} from '../core/errors'
import { isThemeId } from '../core/themeData'
import { isDialect } from '../engine/dialect'
import { GRANUM_CONTRACT_VERSION } from './types'

/** Имя компонента — сегмент пути `components/<Name>/`. */
export const COMPONENT_NAME_PATTERN = /^[A-Z][\w-]*$/i

export function isValidComponentName(name: unknown): name is string {
  return typeof name === 'string' && COMPONENT_NAME_PATTERN.test(name)
}

export function validateProvider(provider: GranumProvider): void {
  if (typeof provider.id !== 'string' || provider.id.trim().length === 0 || /\s/.test(provider.id)) {
    throw new InvalidProviderError(
      String(provider.id),
      'invalid-id',
      `'id' must be a non-empty string without whitespace — it is the 'providerId:ComponentName' key prefix.`,
    )
  }

  validateContractVersion(provider)

  if (provider.baseUrl !== undefined)
    validateBaseUrl(provider.id, provider.baseUrl)

  if (!Array.isArray(provider.components)) {
    throw new InvalidProviderError(
      provider.id,
      'invalid-components',
      `'components' must be an array (got ${typeof provider.components}).`,
    )
  }

  for (const dep of provider.dependencies ?? []) {
    const ok = typeof dep === 'string'
      ? dep.trim().length > 0
      : typeof dep === 'object' && dep !== null && typeof dep.id === 'string'
    if (!ok) {
      throw new InvalidProviderError(
        provider.id,
        'invalid-dependency',
        `'dependencies' entries must be provider instances or non-empty id strings (got ${JSON.stringify(dep)}).`,
      )
    }
  }

  validateEngineContribution(provider)

  const names = new Set<string>()
  for (const descriptor of provider.components) {
    if (!isValidComponentName(descriptor.name))
      throw new InvalidComponentNameError(provider.id, String(descriptor.name))
    if (names.has(descriptor.name))
      throw new DuplicateComponentNameError(provider.id, descriptor.name)
    names.add(descriptor.name)

    for (const path of descriptor.cssFiles ?? []) {
      if (!path.startsWith(`components/${descriptor.name}/`) || path.includes('/../') || path.includes('\\')) {
        throw new InvalidProviderError(
          provider.id,
          'css-file-escapes-component',
          `'cssFiles' entry ${JSON.stringify(path)} must resolve inside 'components/${descriptor.name}/' `
          + `(use defineGranumComponent(import.meta.url, …) with a path relative to config.ts).`,
          descriptor.name,
        )
      }
    }

    validateComponentThemes(provider.id, descriptor)
  }

  validateThemeContribution(provider)
}

/** Ключи вклада в темы контракта 1: их место заняли каталог и `themesDir`. */
const LEGACY_THEME_KEYS = ['themes', 'defaultThemes', 'tokenDefinitions', 'tokenDefinitionsRef'] as const
const LEGACY_COMPONENT_KEYS = ['tokenDefinitions', 'tokenDefinitionsRef'] as const

function hasThemes(provider: GranumProvider): boolean {
  const theme = provider.theme
  return Boolean(theme?.catalog || theme?.registry || theme?.defaultTheme)
    || provider.components.some(descriptor => descriptor.themesDir !== undefined)
}

/**
 * Контракт 2; `1` — только у провайдера без тем: так читается манифест
 * формата 2 спутника, которому темы не нужны.
 */
function validateContractVersion(provider: GranumProvider): void {
  const version = provider.contractVersion as unknown
  if (version === GRANUM_CONTRACT_VERSION)
    return
  if (version === 1 && Array.isArray(provider.components) && !hasThemes(provider))
    return
  throw new UnsupportedContractVersionError(provider.id, version, GRANUM_CONTRACT_VERSION)
}

function validateComponentThemes(providerId: string, descriptor: GranumComponentDescriptor): void {
  for (const key of LEGACY_COMPONENT_KEYS) {
    if ((descriptor as unknown as Record<string, unknown>)[key] !== undefined) {
      throw new InvalidProviderError(
        providerId,
        'legacy-token-definitions',
        `'${key}' was removed in contract 2: put the component tokens into a 'themesDir' folder `
        + `(<dir>/<theme>/root.json and <dir>/<theme>/modes/<mode>.json) and pass 'themesDir' to defineGranumComponent.`,
        descriptor.name,
      )
    }
  }
  if (descriptor.themesDir !== undefined && (typeof descriptor.themesDir !== 'string' || descriptor.themesDir.length === 0))
    throw new InvalidProviderError(providerId, 'invalid-theme-dir', `'themesDir' must be a non-empty path (got ${JSON.stringify(descriptor.themesDir)}).`, descriptor.name)
}

/** Родитель записи каталога; у исходника темы он в theme.json и до сборки неизвестен. */
export function catalogExtends(entry: GranumThemeCatalogEntry | GranumThemeSourceEntry | undefined): string | undefined {
  return entry !== undefined && 'extends' in entry ? entry.extends : undefined
}

/** Каталог: id — slug, родитель и тема по умолчанию — из того же каталога, без циклов. */
function validateThemeContribution(provider: GranumProvider): void {
  const theme = provider.theme
  if (theme === undefined)
    return
  for (const key of LEGACY_THEME_KEYS) {
    if ((theme as unknown as Record<string, unknown>)[key] !== undefined) {
      throw new InvalidProviderError(
        provider.id,
        'legacy-token-definitions',
        `'theme.${key}' was removed in contract 2: a theme is data — declare it in 'theme.catalog' `
        + `({ <id>: { title, data: 'themes/<id>.json' } }) with its modes inside the JSON, and set 'theme.defaultTheme'.`,
      )
    }
  }
  const catalog = theme.catalog ?? {}
  for (const [id, entry] of Object.entries(catalog)) {
    if (!isThemeId(id))
      throw new InvalidProviderError(provider.id, 'invalid-theme-id', `catalog id '${id}' must be a slug /^[a-z][a-z0-9-]*$/.`)
    // Исходник темы: метаданные и `extends` — в его theme.json, их проверяет сборка провайдера (C-43).
    if (entry !== null && typeof entry === 'object' && 'source' in entry) {
      if (typeof entry.source !== 'string' || entry.source.length === 0)
        throw new InvalidProviderError(provider.id, 'invalid-theme-data', `'theme.catalog.${id}.source' must be a path to the theme source folder.`)
      if (entry.ignore !== undefined && (!Array.isArray(entry.ignore) || !entry.ignore.every(path => typeof path === 'string' && path.length > 0)))
        throw new InvalidProviderError(provider.id, 'invalid-theme-data', `'theme.catalog.${id}.ignore' must be an array of paths inside the theme source.`)
      continue
    }
    if (typeof entry?.title !== 'string' || entry.title.length === 0)
      throw new InvalidProviderError(provider.id, 'invalid-theme-data', `'theme.catalog.${id}.title' must be a non-empty string.`)
    if (typeof entry.data !== 'string' || entry.data.length === 0)
      throw new InvalidProviderError(provider.id, 'invalid-theme-data', `'theme.catalog.${id}.data' must be a path to the theme JSON.`)
    if (entry.extends !== undefined && !Object.hasOwn(catalog, entry.extends))
      throw new InvalidProviderError(provider.id, 'theme-extends-unknown', `theme '${id}' extends '${entry.extends}', which is not in the catalog.`)
  }
  for (const id of Object.keys(catalog)) {
    const chain: string[] = []
    for (let current: string | undefined = id; current !== undefined; current = catalogExtends(catalog[current])) {
      if (chain.includes(current))
        throw new InvalidProviderError(provider.id, 'theme-extends-unknown', `catalog themes extend each other in a cycle: ${[...chain, current].join(' -> ')}.`)
      chain.push(current)
    }
  }
  if (theme.defaultTheme !== undefined && !Object.hasOwn(catalog, theme.defaultTheme))
    throw new InvalidProviderError(provider.id, 'invalid-theme-id', `'theme.defaultTheme' '${theme.defaultTheme}' is not in the catalog (${Object.keys(catalog).join(', ') || 'empty'}).`)
}

/**
 * Вклад в движок: правила без объявленного словаря непригодны к проверке,
 * а диалект не своего формата нельзя сравнить равенством с чужим.
 */
function validateEngineContribution(provider: GranumProvider): void {
  const engine = provider.engine
  if (engine === undefined)
    return
  const hasRules = Boolean(engine.rules?.length || engine.variants?.length || engine.preflights?.length)
  if (engine.dialect === undefined) {
    if (hasRules) {
      throw new InvalidProviderError(
        provider.id,
        'rules-without-dialect',
        `'engine' declares rules, variants or preflights without 'engine.dialect'. `
        + `A rule is written against one vocabulary of class names — name it, so applications can tell whether they may run it.`,
      )
    }
    return
  }
  if (!isDialect(engine.dialect)) {
    throw new InvalidProviderError(
      provider.id,
      'invalid-dialect',
      `'engine.dialect' must look like '<vendor>/<vocabulary>@<major>' (got ${JSON.stringify(engine.dialect)}).`,
    )
  }
}

export function validateBaseUrl(providerId: string, baseUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  }
  catch {
    throw new InvalidProviderError(
      providerId,
      'invalid-base-url',
      `'baseUrl' must be an absolute URL (got ${JSON.stringify(baseUrl)}). `
      + `Use resolvePackageBaseUrl(import.meta.url) from '@feugene/granum/contract'.`,
    )
  }
  if (!parsed.pathname.endsWith('/')) {
    throw new InvalidProviderError(
      providerId,
      'base-url-not-a-directory',
      `'baseUrl' must point to a DIRECTORY and end with '/' (got ${JSON.stringify(baseUrl)}); `
      + `otherwise every relative resolution silently drops its last segment.`,
    )
  }
}

/** Проверка одного дескриптора вне провайдера — для `defineGranumComponent`. */
export function assertComponentDescriptor(descriptor: GranumComponentDescriptor): void {
  if (!isValidComponentName(descriptor.name))
    throw new InvalidComponentNameError('(unbound)', String(descriptor.name))
  validateComponentThemes('(unbound)', descriptor)
}
