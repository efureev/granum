/**
 * Резолвер для инструментов auto-import: по имени компонента отдаёт
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
import { uniqueDeclarers } from '../core/providerNode'
import { resolveGranum } from '../core/resolve'
import { loadProviderInputs } from '../node/prepare'

/**
 * Резолверу нужен только список провайдеров: он строит индекс имён по
 * манифестам и не генерирует CSS, а значит и движок ему не нужен.
 */
export type GranumResolverConfig = Pick<GranumConfig, 'providers'>

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

/**
 * Имя → subpath по правилу имён тегов (`uniqueDeclarers`): неоднозначное имя
 * (у двух провайдеров) не резолвится, компонент первичен. Часть составного
 * компонента резолвится своим подпутём — он ведёт в модуль владельца, и guard с
 * селекцией сводят его к владельцу.
 */
export function buildComponentIndex(config: GranumResolverConfig, root: string, options: GranumResolverOptions = {}): ReadonlyMap<string, GranumResolvedComponent> {
  const inputs = loadProviderInputs(config, root)
  const registry = resolveGranum({ providers: inputs, components: [] }).registry
  const allowed = options.providers ? new Set(options.providers) : undefined
  const providers = [...registry.providers.values()].filter(provider => !allowed || allowed.has(provider.id))
  const index = new Map<string, GranumResolvedComponent>()
  for (const [name, provider] of uniqueDeclarers(providers)) {
    if (options.prefix === undefined || name.startsWith(options.prefix))
      index.set(name, { name, from: `${provider.id}/components/${name}` })
  }
  return index
}

export function granumResolver(config: GranumResolverConfig, options: GranumResolverOptions = {}): GranumComponentResolver {
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
