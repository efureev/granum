/**
 * Разворачивает корни и транзитивный граф `dependencies` в плоский,
 * дедуплицированный, топологически упорядоченный список узлов (зависимости
 * раньше зависящих). Правила:
 *
 *   - дедуп по `id`; два РАЗНЫХ инстанса с одним id — `DuplicateProviderIdError`;
 *     тот же инстанс в ромбе — норма;
 *   - цикл — `CircularProviderDependencyError` с цепочкой;
 *   - строковые зависимости мягкие: ничего не тянут, но к концу обхода id
 *     обязан быть в реестре — иначе `UnresolvedProviderDependencyError`.
 *     Порядок они задают наравне с объектными: у манифестов других
 *     зависимостей нет, и без этого донор вставал бы после зависящего, если так
 *     стоят строки в конфиге;
 *   - каждый объект проходит `validateProvider`; манифест считается
 *     проверенным читателем.
 */
import type { GranumProvider, GranumProviderInput } from '../contract'
import type { ProviderNode } from './providerNode'
import { isLoadedManifest } from '../contract/manifest'
import { validateProvider } from '../contract/validate'
import {
  CircularProviderDependencyError,
  DuplicateProviderIdError,
  UnresolvedProviderDependencyError,
} from './errors'
import { toProviderNode } from './providerNode'

export function expandProviders(roots: readonly GranumProviderInput[]): ProviderNode[] {
  const byId = new Map<string, ProviderNode>()
  const order: ProviderNode[] = []
  const onStack = new Set<string>()
  const pendingStrings: { id: string, from: string }[] = []

  const visit = (input: GranumProviderInput, path: readonly string[]): void => {
    if (!isLoadedManifest(input))
      validateProvider(input)

    const node = toProviderNode(input)
    const existing = byId.get(node.id)
    if (existing) {
      if (existing.source !== input && !sameManifest(existing.source, input))
        throw new DuplicateProviderIdError(node.id, [...path, node.id])
      return
    }
    if (onStack.has(node.id))
      throw new CircularProviderDependencyError([...path, node.id])

    onStack.add(node.id)
    for (const dep of node.dependencies) {
      if (typeof dep === 'string') {
        pendingStrings.push({ id: dep, from: node.id })
        continue
      }
      visit(dep as GranumProvider, [...path, node.id])
    }
    onStack.delete(node.id)

    byId.set(node.id, node)
    order.push(node)
  }

  for (const root of roots)
    visit(root, [])

  for (const { id, from } of pendingStrings) {
    if (!byId.has(id))
      throw new UnresolvedProviderDependencyError(id, from)
  }

  return graphOrder(order, byId)
}

/**
 * Порядок графа по обоим видам рёбер. Обход выше уже поставил объектных доноров
 * раньше зависящих; повторный post-order по всем рёбрам добавляет строковые и
 * ловит циклы через них. Узлы без связи между собой сохраняют порядок
 * обнаружения, то есть порядок конфига.
 */
function graphOrder(nodes: readonly ProviderNode[], byId: ReadonlyMap<string, ProviderNode>): ProviderNode[] {
  const out: ProviderNode[] = []
  const done = new Set<string>()
  const stack: string[] = []

  const visit = (node: ProviderNode): void => {
    if (done.has(node.id))
      return
    const at = stack.indexOf(node.id)
    if (at >= 0)
      throw new CircularProviderDependencyError([...stack.slice(at), node.id])
    stack.push(node.id)
    for (const dep of node.dependencies)
      visit(byId.get(typeof dep === 'string' ? dep : dep.id)!)
    stack.pop()
    done.add(node.id)
    out.push(node)
  }

  for (const node of nodes)
    visit(node)
  return out
}

/** Два прочитанных манифеста одного файла — один провайдер, а не конфликт. */
function sameManifest(a: GranumProviderInput, b: GranumProviderInput): boolean {
  return isLoadedManifest(a) && isLoadedManifest(b)
    && a.baseUrl === b.baseUrl
    && a.manifest.hash === b.manifest.hash
}
