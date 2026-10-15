/**
 * Встроенный набор правил поверх preset-wind3. Порядок: сначала
 * доп-правила, затем правила провайдеров и приложения — при совпадении матчится
 * последнее, так провайдер перекрывает встроенное.
 */
import type { Rule } from '../vendor/core/index.js'
import { colorOpacityRules } from './extra/index.js'

export const builtinExtraRules: readonly Rule<any>[] = [...colorOpacityRules]
