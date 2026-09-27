import { defineGranumConfig } from '@feugene/granum/vite'
import { miniEngine } from '@feugene/granum-engine-mini'

/**
 * Конфиг стенда серверного рендера.
 *
 * Селекция намеренно разнородная: у каждого компонента свой способ приносить
 * стили, и на сервере это ничего не меняет — проверить это и есть смысл стенда.
 *
 *   - `XgQuick` тянет `XTest1` из другого пакета: замыкание графа считается по
 *     манифестам, а не по импортам серверного бандла;
 *   - `XTest1` приносит собственный CSS-файл — он инлайнится в слой `components`;
 *   - `XhCard` берёт токены темы из CSS-файлов провайдера;
 *   - `XTokenized` объявляет токены тем структурно, через `tokenDefinitions`.
 *
 * Темы заданы явно: обе уезжают в CSS, и серверу остаётся выбрать, какая
 * активна в этом ответе. Обрезка токенов включена — она считает достижимость по
 * разметке приложения, и серверный рендер её не обманывает: разметка лежит в
 * `src`, как у обычного приложения.
 */
export default defineGranumConfig({
  engine: miniEngine(),
  providers: [
    '@granum-fixtures/extra-simple',
    '@granum-fixtures/simple',
    '@granum-fixtures/heavy',
  ],
  components: [
    '@granum-fixtures/extra-simple:XgQuick',
    '@granum-fixtures/heavy:XhCard',
    '@granum-fixtures/simple:XTokenized',
  ],
  themes: { names: ['light', 'dark'] },
  pruneTokens: { mode: 'on' },
  appSources: { dirs: ['src'] },
})
