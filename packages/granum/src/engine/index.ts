/**
 * Точка входа `./engine` (ТЗ §9, E-7). Browser-safe, без зависимостей и без
 * реализации движка: ядро отдаёт только контракт и хелперы, которыми пользуются
 * авторы движков. Сам движок приложение выбирает и передаёт инстансом
 * (`@feugene/granum-engine-wind` или свой).
 */
export { GRANUM_DIALECT_PATTERN, isDialect, parseDialect } from './dialect'
export type { ParsedDialect } from './dialect'
export { extractClasses, stripComments } from './extract'
export { ruleIdentifier, variantIdentifier, vocabularyFingerprint } from './fingerprint'
export type { VocabularyParts } from './fingerprint'
export type * from './types'
