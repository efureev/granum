import { defineGranumConfig } from '@feugene/granum/vite'
import { miniEngine } from '@feugene/granum-engine-mini'

/**
 * Скан вложенных SFC и дополнительные правила движка под чужим префиксом
 * переменных. Части `XNestedReverse` лежат в соседнем `reverses/parts/` и
 * попадают в его чанк — их классы извлечены сборкой провайдера в манифест.
 * Доп-правила (spinner, bracket-цвет с `/NN`, filter, `font-variant-numeric`,
 * object-*, space-* и divide-*, sr-only) встроены в движок; `variablePrefix`
 * обязан переименовать переменные и в утилитах, и в preflights, и в
 * `@property` — иначе утилиты ссылались бы на `--ds-*`, а объявлены были бы
 * `--un-*`.
 */
export default defineGranumConfig({
  providers: ['@granum-fixtures/simple'],
  components: ['@granum-fixtures/simple:XNestedReverse'],
  engine: miniEngine({ variablePrefix: 'ds-' }),
  appSources: { dirs: ['src'] },
})
