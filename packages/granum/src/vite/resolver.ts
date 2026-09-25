/**
 * Резолвер для инструментов auto-import (A-8): по имени компонента отдаёт
 * subpath провайдера. Форма совместима с `unplugin-vue-components`
 * (`{ type: 'component', resolve(name) → { name, from } }`), но зависимости от
 * него нет — объект структурный.
 *
 * Селекция в режиме `components: 'imports'` пополняется не отсюда, а сканом
 * тегов в `appSources` (`prepareApp`): порядок трансформаций у бандлера не
 * определён, и запись «кто что резолвил» в момент трансформации опоздала бы
 * к эмиссии CSS. Резолвер лишь сообщает бандлеру, откуда импортировать.
 */
import type { GranumConfig } from '../config'
import process from 'node:process'
import { resolveGranum } from '../core/resolve'
import { loadProviderInputs } from '../node/prepare'

export interface GranumResolverOptions {
  /** Корень приложения, от которого ищутся манифесты. По умолчанию `process.cwd()`. */
  readonly root?: string
  /** Ограничить провайдеров по id. По умолчанию — все из конфига. */
  readonly providers?: readonly string[]
  /** Обязательный префикс имени компонента (`Xh`). По умолчанию — любое имя. */
  readonly prefix?: string
}

export interface GranumResolvedComponent {
  readonly name: string
  readonly from: string
}

export interface GranumComponentResolver {
  readonly type: 'component'
  resolve: (name: string) => GranumResolvedComponent | undefined
  /** Все имена, известные резолверу (уникальные среди провайдеров). */
  names: () => readonly string[]
}

/** Имя → subpath; неоднозначное имя (у двух провайдеров) не резолвится. */
export function buildComponentIndex(config: GranumConfig, root: string, options: GranumResolverOptions = {}): ReadonlyMap<string, GranumResolvedComponent> {
  const inputs = loadProviderInputs(config, root)
  const registry = resolveGranum({ providers: inputs, components: [] }).registry
  const allowed = options.providers ? new Set(options.providers) : undefined
  const owners = new Map<string, string[]>()
  for (const [, entry] of registry.components) {
    if (allowed && !allowed.has(entry.provider.id))
      continue
    if (options.prefix !== undefined && !entry.component.name.startsWith(options.prefix))
      continue
    owners.set(entry.component.name, [...(owners.get(entry.component.name) ?? []), entry.provider.id])
  }
  const index = new Map<string, GranumResolvedComponent>()
  for (const [name, providers] of owners) {
    if (providers.length === 1)
      index.set(name, { name, from: `${providers[0]}/components/${name}` })
  }
  return index
}

export function granumResolver(config: GranumConfig, options: GranumResolverOptions = {}): GranumComponentResolver {
  let index: ReadonlyMap<string, GranumResolvedComponent> | undefined
  const load = (): ReadonlyMap<string, GranumResolvedComponent> => {
    index ??= buildComponentIndex(config, options.root ?? process.cwd(), options)
    return index
  }
  return {
    type: 'component',
    resolve: name => load().get(name),
    names: () => [...load().keys()].sort(),
  }
}
