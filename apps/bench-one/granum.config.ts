import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Ровно один компонент. Его граф разворачивает ещё четыре
 * (XhCard, XhButton, XhAlert, XhOverlay). Обе темы — честный худший случай:
 * приложение, которое умеет переключаться, платит за оба файла.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/heavy'],
  components: ['@granum-fixtures/heavy:XhPanel'],
  themes: { names: ['light', 'dark'] },
  appSources: { dirs: ['src'] },
})
