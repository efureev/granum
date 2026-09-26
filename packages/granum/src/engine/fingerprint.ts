/**
 * Отпечаток словаря (E-4, E-6) — машинный ключ множества имён, которые движок
 * умеет сгенерировать. По нему приложение решает, верить списку классов
 * манифеста или пересчитать его: внутри одного мажора набор имён не постоянен
 * (апстрим добавляет правила в минорах, приложение — свои правила фабрике), и
 * ни диалект, ни номер версии этого не различают.
 *
 * Считается по идентификаторам правил и именам вариантов, а не по их коду:
 * вопрос стоит «какие имена возможны», а не «какой CSS выйдет». Изменение
 * реализации правила при том же матчере отпечаток не меняет — и не должно:
 * список классов манифеста от этого не становится неполным.
 *
 * Хеш некриптографический (64 бита двумя проходами FNV-1a): он ключует решение
 * сборки, подделывать его некому, а цена коллизии — один пропущенный пересчёт
 * на 2^64 различных словарей. Модуль browser-safe и без зависимостей: `./engine`
 * не имеет права тянуть `node:crypto`.
 */
import type { GranumRule, GranumVariant } from './types'

export interface VocabularyParts {
  readonly rules?: readonly GranumRule[]
  readonly variants?: readonly GranumVariant[]
}

/** Разделитель между длиной и телом во втором проходе — байт, невозможный в идентификаторе. */
const LENGTH_SEPARATOR = String.fromCharCode(1)

/** Идентификатор правила: имя статического либо `source` и флаги динамического. */
export function ruleIdentifier(rule: GranumRule): string {
  const matcher = rule[0]
  return typeof matcher === 'string' ? `s:${matcher}` : `d:${matcher.source}:${matcher.flags}`
}

/**
 * Идентификатор варианта: собственное имя, имя функции-матчера или позиция.
 * Позиция — последнее средство для анонимного варианта: она делает отпечаток
 * зависимым от порядка объявления, что хуже имени, но всё ещё детерминировано.
 */
export function variantIdentifier(variant: GranumVariant, index: number): string {
  if (typeof variant === 'function')
    return `v:${variant.name || `#${index}`}`
  return `v:${variant.name || variant.match.name || `#${index}`}`
}

/**
 * Отпечаток набора правил и вариантов. Порядок не учитывается: он влияет на то,
 * какое правило победит, но не на множество допустимых имён.
 */
export function vocabularyFingerprint(parts: VocabularyParts): string {
  const ids = [
    ...(parts.rules ?? []).map(ruleIdentifier),
    ...(parts.variants ?? []).map(variantIdentifier),
  ].sort()
  const text = ids.join('\n')
  const hi = fnv1a(text, 0x811C9DC5)
  const lo = fnv1a(`${ids.length}${LENGTH_SEPARATOR}${text}`, 0xC0FFEE11)
  return `fnv64-${hex(hi)}${hex(lo)}`
}

function fnv1a(text: string, seed: number): number {
  let hash = seed
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function hex(value: number): string {
  return value.toString(16).padStart(8, '0')
}
