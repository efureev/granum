/**
 * Проверки контракта при регистрации (C-19, INV-ERR-1). Их вызывают и
 * `defineGranumProvider`, и `expandProviders` — рукописный объект без хелпера
 * проходит те же проверки.
 */
import type { GranumComponentDescriptor, GranumProvider, GranumTokenSet } from './types'
import {
  DuplicateComponentNameError,
  InvalidComponentNameError,
  InvalidProviderError,
  InvalidTokenKeyError,
  UnsupportedContractVersionError,
} from '../core/errors'
import { GRANUM_CONTRACT_VERSION } from './types'

/** Имя компонента — сегмент пути `components/<Name>/` (INV-CON-2). */
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

  if (provider.contractVersion !== GRANUM_CONTRACT_VERSION)
    throw new UnsupportedContractVersionError(provider.id, provider.contractVersion, GRANUM_CONTRACT_VERSION)

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

    validateTokenSets(provider.id, descriptor.tokenDefinitions, descriptor.name)
  }

  validateTokenSets(provider.id, provider.theme?.tokenDefinitions)
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

function validateTokenSets(
  providerId: string,
  sets: Readonly<Record<string, GranumTokenSet>> | undefined,
  componentName?: string,
): void {
  if (!sets)
    return
  for (const [theme, set] of Object.entries(sets)) {
    for (const token of Object.keys(set.tokens)) {
      if (token.startsWith('--'))
        throw new InvalidTokenKeyError(providerId, token, theme, componentName)
    }
  }
}

/** Проверка одного дескриптора вне провайдера — для `defineGranumComponent`. */
export function assertComponentDescriptor(descriptor: GranumComponentDescriptor): void {
  if (!isValidComponentName(descriptor.name))
    throw new InvalidComponentNameError('(unbound)', String(descriptor.name))
  validateTokenSets('(unbound)', descriptor.tokenDefinitions, descriptor.name)
}
