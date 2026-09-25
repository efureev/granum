/**
 * Материализация `tokenDefinitionsRef` объектной формы провайдера (C-13,
 * INV-THM-5, INV-THM-6): ссылки на CSS читаются и превращаются в литеральные
 * `tokenDefinitions`. На сборке провайдера это делает `./build` для манифеста;
 * в приложении — медленный путь для провайдеров без манифеста (R-6).
 *
 * Литеральные `tokenDefinitions` той же темы важнее ссылки. Читаются только
 * темы из `needed`; если фильтр пуст — читаются все.
 */
import type { GranumComponentDescriptor, GranumProvider, GranumTokenRef, GranumTokenSet } from '../contract'
import { TokenRefError } from '../core/errors'
import { tokenSetFromCssSync } from './cssTokens'

interface RefContext {
  readonly providerId: string
  readonly componentName?: string
  /** База для относительных строковых ссылок провайдера (`theme.tokenDefinitionsRef`). */
  readonly baseUrl?: string
}

function readTokenSet(themeName: string, ref: GranumTokenRef | string, context: RefContext): GranumTokenSet {
  const normalized: GranumTokenRef = typeof ref === 'string' ? { url: ref } : ref
  const url = /^[a-z]+:/i.test(normalized.url) || normalized.url.startsWith('/')
    ? normalized.url
    : context.baseUrl !== undefined ? new URL(normalized.url, context.baseUrl).href : normalized.url
  try {
    return tokenSetFromCssSync(url, {
      ...(normalized.selector !== undefined ? { selector: normalized.selector } : {}),
      ...(normalized.as !== undefined ? { as: normalized.as } : {}),
      ...(normalized.strict !== undefined ? { strict: normalized.strict } : {}),
    })
  }
  catch (cause) {
    throw new TokenRefError(context.providerId, themeName, context.componentName, normalized.url, { cause })
  }
}

function materializeMap(
  refs: Readonly<Record<string, GranumTokenRef | string>> | undefined,
  literals: Readonly<Record<string, GranumTokenSet>> | undefined,
  context: RefContext,
  needed: ReadonlySet<string> | undefined,
): Readonly<Record<string, GranumTokenSet>> | undefined {
  if (!refs)
    return literals
  const resolved: Record<string, GranumTokenSet> = {}
  for (const [themeName, ref] of Object.entries(refs)) {
    if (needed && !needed.has(themeName))
      continue
    resolved[themeName] = readTokenSet(themeName, ref, context)
  }
  if (Object.keys(resolved).length === 0)
    return literals
  return { ...resolved, ...literals }
}

export function materializeComponentRefs(
  descriptor: GranumComponentDescriptor,
  providerId: string,
  needed?: ReadonlySet<string>,
): GranumComponentDescriptor {
  if (!descriptor.tokenDefinitionsRef)
    return descriptor
  const tokenDefinitions = materializeMap(
    descriptor.tokenDefinitionsRef,
    descriptor.tokenDefinitions,
    { providerId, componentName: descriptor.name },
    needed,
  )
  if (tokenDefinitions === descriptor.tokenDefinitions)
    return descriptor
  const { tokenDefinitionsRef: _dropped, ...rest } = descriptor
  return { ...rest, ...(tokenDefinitions ? { tokenDefinitions } : {}) }
}

/**
 * Провайдер с прочитанными ссылками. Без ссылок возвращается тот же объект —
 * на идентичности держится дедупликация графа.
 */
export function materializeProviderRefs(provider: GranumProvider, needed?: ReadonlySet<string>): GranumProvider {
  const components = provider.components.map(descriptor => materializeComponentRefs(descriptor, provider.id, needed))

  let theme = provider.theme
  if (theme?.tokenDefinitionsRef) {
    const tokenDefinitions = materializeMap(
      theme.tokenDefinitionsRef,
      theme.tokenDefinitions,
      { providerId: provider.id, ...(provider.baseUrl !== undefined ? { baseUrl: provider.baseUrl } : {}) },
      needed,
    )
    if (tokenDefinitions !== theme.tokenDefinitions) {
      const { tokenDefinitionsRef: _dropped, ...rest } = theme
      theme = { ...rest, ...(tokenDefinitions ? { tokenDefinitions } : {}) }
    }
  }

  const changed = theme !== provider.theme || components.some((c, i) => c !== provider.components[i])
  if (!changed)
    return provider
  return { ...provider, components, ...(theme ? { theme } : {}) }
}
