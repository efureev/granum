import { defineGranumComponent } from '@feugene/granum/contract'

/** Одна запись селекции разворачивает граф из пяти; единственный объявленный `cssFiles`. */
export const xhPanelConfig = defineGranumComponent(import.meta.url, {
  name: 'XhPanel',
  dependencies: ['XhCard', 'XhButton', 'XhAlert', 'XhOverlay'],
  cssFiles: ['./styles.css'],
})
