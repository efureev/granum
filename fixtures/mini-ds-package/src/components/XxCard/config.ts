import { defineGranumComponent } from '@feugene/granum/contract'

/** Единственный компонент с собственным CSS: его файл инлайнится по манифесту. */
export const xxCardConfig = defineGranumComponent(import.meta.url, {
  name: 'XxCard',
  cssFiles: ['./styles.css'],
})
