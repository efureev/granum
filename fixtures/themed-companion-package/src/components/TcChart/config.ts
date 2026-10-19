import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Токены только для `ink`: при активной `paper` их нет в CSS. Папка `unknown`
 * — тема, которой нет ни в одном каталоге: приложение называет её
 * предупреждением `component-theme-unknown`, а не ошибкой.
 */
export const tcChartConfig = defineGranumComponent(import.meta.url, {
  name: 'TcChart',
  themesDir: './themes',
})
