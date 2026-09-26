/**
 * Встроенный набор правил поверх preset-mini (E-4). Порядок тот же, что в
 * пресете v1: сначала доп-правила, затем правила провайдеров и приложения —
 * при совпадении матчится последнее (INV-ENG-3), так провайдер перекрывает
 * встроенное.
 */
import type { Preflight, Rule, Variant } from '../vendor/core/index.js'
import {
  accessibilityRules,
  animationPreflights,
  animationRules,
  colorOpacityRules,
  filterRules,
  numericPreflights,
  numericRules,
  objectRules,
  spacingRules,
  spacingVariants,
  typographyRules,
} from './extra/index.js'

export const builtinExtraRules: readonly Rule<any>[] = [
  ...accessibilityRules,
  ...animationRules,
  ...colorOpacityRules,
  ...filterRules,
  ...numericRules,
  ...objectRules,
  ...spacingRules,
  ...typographyRules,
]

export const builtinExtraVariants: readonly Variant<any>[] = [...spacingVariants]

/** `animate-spin` ссылается на `@keyframes`, `tabular-nums` и соседи — на пять переменных. */
export const builtinExtraPreflights: readonly Preflight<any>[] = [...animationPreflights, ...numericPreflights]
