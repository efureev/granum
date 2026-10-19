import { defineGranumProvider } from '@feugene/granum/contract'
import { WIND_DIALECT_EXTRA } from '@feugene/granum-engine-wind'
import { brandRules } from './engine.ts'

/**
 * Пакет без компонентов: только правила движка. Диалект — тот же, что у
 * ванильного `windEngine()` приложения, иначе приложение правила не загрузит.
 */
export const rulesOnlyProvider = defineGranumProvider({
  id: '@granum-fixtures/rules-only',
  contractVersion: 2,
  components: [],
  engine: { dialect: WIND_DIALECT_EXTRA, rules: brandRules },
})
