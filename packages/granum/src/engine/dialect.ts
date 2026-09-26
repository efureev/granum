/**
 * Диалект — имя словаря классов (E-1). Формат `<vendor>/<vocabulary>@<major>`,
 * сравнение строгим равенством строк: мажор в конце — часть имени, а не
 * диапазон, потому что `@66` и `@67` — разные словари, а не версии одного.
 *
 * Диалектом управляется ровно одно решение — грузить ли модуль правил
 * провайдера (A-E6). Доверие списку классов манифеста ключуется отпечатком
 * словаря (`./fingerprint`), а не диалектом: внутри одного мажора набор имён
 * меняется, и диалект этого по определению не видит.
 */

/** `<vendor>/<vocabulary>@<major>`: `unocss/preset-mini+granum@66`, `granum-fixtures/atoms@1`. */
export const GRANUM_DIALECT_PATTERN = /^[a-z0-9][\w.-]*\/[\w.+-]+@\d+$/

export interface ParsedDialect {
  /** Кто выпускает словарь: `unocss`, `tailwind`, имя организации. */
  readonly vendor: string
  /** Имя словаря внутри вендора, с необязательными расширениями через `+`. */
  readonly vocabulary: string
  /** Мажор словаря. */
  readonly major: number
}

export function isDialect(value: unknown): value is string {
  return typeof value === 'string' && GRANUM_DIALECT_PATTERN.test(value)
}

/** Разбор диалекта на части; `undefined`, если строка не проходит E-1. */
export function parseDialect(value: string): ParsedDialect | undefined {
  if (!GRANUM_DIALECT_PATTERN.test(value))
    return undefined
  const slash = value.indexOf('/')
  const at = value.lastIndexOf('@')
  return {
    vendor: value.slice(0, slash),
    vocabulary: value.slice(slash + 1, at),
    major: Number(value.slice(at + 1)),
  }
}
