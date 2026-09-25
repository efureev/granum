/**
 * Точка входа `./engine` (ТЗ §9). Browser-safe, без зависимостей.
 * Встроенная реализация появляется на этапе 2.
 */
import type { GranumEngine } from './types'
import { notImplemented } from '../internal/notImplemented'

export type * from './types'

/** Встроенный движок: вендоренное ядро + правила (E-4). Этап 2. */
export function createEngine(): GranumEngine {
  return notImplemented('createEngine', 'stage 2')
}
