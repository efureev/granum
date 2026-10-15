/** Отсортированный массив уникальных строк — детерминированная форма множества. */
export function sortedUnique(items: Iterable<string>): string[] {
  return [...new Set(items)].sort()
}
