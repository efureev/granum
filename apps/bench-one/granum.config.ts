import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Ровно один компонент. Его граф разворачивает ещё четыре
 * (XhCard, XhButton, XhAlert, XhOverlay). Оба режима — честный худший случай:
 * приложение, которое умеет переключаться, платит за оба блока.
 *
 * Обрезка выключена явно: стенд — точка отсчёта для `bench-pruned`, а по
 * умолчанию она включена (ADR-14).
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/heavy'],
  components: ['@granum-fixtures/heavy:XhPanel'],
  themes: [{ theme: 'heavy', modes: ['light', 'dark'] }],
  appSources: { dirs: ['src'] },
  pruneTokens: { mode: 'off' },
})
