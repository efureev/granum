/**
 * Части составных компонентов по `package.json#exports` провайдера.
 *
 * Часть (`XcListItem`) своего entry не имеет: её код в модуле владельца, а
 * подпуть `./components/XcListItem` — алиас, который пишет `codegen
 * --subcomponents` или автор руками. Именно этим подпутём её импортирует
 * приложение, поэтому источник правды — `exports`, а не баррель: часть — тот
 * подпуть, что ведёт в entry компонента под чужим именем. Сборка провайдера
 * записывает её в манифест владельца (медленный путь объектного провайдера —
 * в синтетический), и guard, селекция и граф провайдера-соседа судят по ней
 * владельца, не читая `exports` сами.
 */
import { isValidComponentName } from '../contract'

/** Компонент и его entry: пути от корня пакета, POSIX, без `./`. */
export interface ComponentEntries {
  readonly name: string
  readonly entries: readonly string[]
}

export interface ExportsSubcomponents {
  /** Владелец → его части, отсортированы. */
  readonly byOwner: Readonly<Record<string, readonly string[]>>
  /** Подпути, что ведут в entry нескольких компонентов сразу: частью не считаются. */
  readonly ambiguous: readonly string[]
}

const COMPONENT_SUBPATH = './components/'

/** Путь от корня пакета без `./` и с прямыми слешами. */
function packagePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Цели значения `exports`: все строковые листья — строка, условный объект любой
 * вложенности, массив запасных вариантов. Ветка `types` — объявления, а не
 * модуль, и целью не считается; `null` закрывает подпуть для условия.
 */
function targetsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(packagePath(value))
  }
  else if (Array.isArray(value)) {
    value.forEach(item => targetsOf(item, out))
  }
  else if (typeof value === 'object' && value !== null) {
    for (const [condition, nested] of Object.entries(value)) {
      if (condition !== 'types')
        targetsOf(nested, out)
    }
  }
  return out
}

export function subcomponentsFromExports(exports: unknown, components: readonly ComponentEntries[]): ExportsSubcomponents {
  const byOwner: Record<string, string[]> = {}
  const ambiguous: string[] = []
  if (typeof exports !== 'object' || exports === null || Array.isArray(exports))
    return { byOwner, ambiguous }

  const ownerOfEntry = new Map<string, string>()
  for (const component of components) {
    for (const entry of component.entries)
      ownerOfEntry.set(packagePath(entry), component.name)
  }
  const names = new Set(components.map(component => component.name))

  for (const [key, value] of Object.entries(exports)) {
    if (!key.startsWith(COMPONENT_SUBPATH))
      continue
    const name = key.slice(COMPONENT_SUBPATH.length)
    // Имя части — по тому же правилу, что имя компонента: без `/`, `.` и `*`.
    if (!isValidComponentName(name) || names.has(name))
      continue
    const owners = new Set(targetsOf(value).flatMap(target => ownerOfEntry.get(target) ?? []))
    if (owners.size > 1)
      ambiguous.push(name)
    else if (owners.size === 1)
      (byOwner[[...owners][0]!] ??= []).push(name)
  }

  for (const parts of Object.values(byOwner))
    parts.sort()
  return { byOwner, ambiguous: ambiguous.sort() }
}
