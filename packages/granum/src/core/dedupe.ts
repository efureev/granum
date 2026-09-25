/** Отсортированный массив уникальных строк — детерминированная форма множества (INV-DET-3). */
export function sortedUnique(items: Iterable<string>): string[] {
  return [...new Set(items)].sort()
}
