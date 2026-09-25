/**
 * Кросс-провайдерные доноры и `peerDependencies` пакета (C-5, INV-CON-9):
 * провайдер, чьи компоненты зависят от компонентов другого провайдера или
 * который тянет донора инстансом/строкой, обязан перечислить донора в
 * `peerDependencies` (или `dependencies`). Чистая функция над данными.
 */
import type { GranumProvider } from '../contract/types'

export interface PackageDependencyFields {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
}

/** Идентификаторы всех доноров провайдера: из `dependencies` провайдера и из зависимостей компонентов вида `id:Name` / `{ provider }`. */
export function collectDonorIds(provider: GranumProvider): string[] {
  const out = new Set<string>()
  for (const dep of provider.dependencies ?? [])
    out.add(typeof dep === 'string' ? dep : dep.id)
  for (const component of provider.components) {
    for (const dep of component.dependencies ?? []) {
      if (typeof dep === 'string') {
        const colon = dep.lastIndexOf(':')
        if (colon > 0)
          out.add(dep.slice(0, colon))
      }
      else {
        out.add(dep.provider)
      }
    }
  }
  out.delete(provider.id)
  return [...out].sort()
}

/** Доноры, которых нет ни в `peerDependencies`, ни в `dependencies`, ни в `optionalDependencies` пакета. */
export function findMissingPeers(provider: GranumProvider, pkg: PackageDependencyFields): string[] {
  const declared = new Set([
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ])
  return collectDonorIds(provider).filter(id => !declared.has(id))
}
