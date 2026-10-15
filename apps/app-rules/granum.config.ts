import { windEngine } from '@feugene/granum-engine-wind'
import { defineGranumConfig } from '@feugene/granum/vite'

/**
 * Ванильный движок: своих правил приложение фабрике не передаёт — они в пакете
 * `@granum-fixtures/rules-only`. Отпечаток словаря движка совпадает с
 * отпечатком пакета, и сборка идёт быстрым путём, без пересчёта классов.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/rules-only'],
  appSources: { dirs: ['src'] },
})
