/**
 * Точка входа `./engine` (ТЗ §9). Browser-safe, без зависимостей: ядро
 * UnoCSS вендорено (ADR-2). Публичная поверхность — только собственные типы.
 */
export { createEngine } from './builtin'
export { extractClasses, stripComments } from './extract'
export type * from './types'
