import { defineGranumConfig } from '@feugene/granum/vite'
import { atomsEngine } from '@granum-engines/atoms'

/**
 * Приложение на движке, которого в granum нет вовсе: `@granum-engines/atoms`
 * реализует `GranumEngine` с нуля, на публичных хелперах ядра. Это и есть
 * доказательство, что движок сменный (E-7, AC-E2).
 *
 * В одной сборке два пакета с разной природой:
 *   - `@granum-fixtures/atoms` говорит на том же словаре, что движок, и привозит
 *     свои правила модулем — они загружаются, и `atom-frame` попадает в CSS;
 *   - `@granum-fixtures/plain` не зависит ни от какого словаря (`dialect: null`)
 *     и работает с любым движком без пересчёта.
 *
 * Правило приложения `atom-hairline` передано фабрике движка, а не конфигу: у
 * конфига поля для правил нет и не будет (E-10).
 */
export default defineGranumConfig({
  engine: atomsEngine({ rules: [['atom-hairline', { 'border-bottom': '1px solid var(--at-line)' }]] }),
  providers: ['@granum-fixtures/atoms', '@granum-fixtures/plain'],
  components: ['@granum-fixtures/atoms:AtBox', '@granum-fixtures/plain:PlCard'],
  appSources: { dirs: ['src'] },
})
