import type { GranumAppTheme } from '@feugene/granum'

/**
 * «Песок» — своя тема приложения. Данные полные: тему-объект никто не
 * дособирает, `extends` лишь говорит granum, чьи токены компонентов брать за
 * основу, — здесь «Бумаги» из пакета.
 */
export const sand: GranumAppTheme = {
  id: 'sand',
  title: 'Песок',
  extends: 'paper',
  root: {
    'th-font': 'ui-rounded, system-ui, sans-serif',
    'th-radius': '12px',
    'th-ring': '0 0 0 3px var(--th-accent)',
  },
  defaultMode: 'light',
  modes: {
    light: {
      title: 'Светлый',
      colorScheme: 'light',
      tokens: {
        'th-accent': '#b45309',
        'th-accent-fg': '#ffffff',
        'th-bg': '#fdf8f0',
        'th-fg': '#3f2d1d',
        'th-line': '#e7dcc8',
        'th-shade': 'color-mix(in oklab, var(--th-fg) 6%, var(--th-bg))',
      },
    },
    dark: {
      title: 'Тёмный',
      colorScheme: 'dark',
      tokens: {
        'th-accent': '#f59e0b',
        'th-accent-fg': '#1c1206',
        'th-bg': '#1c1712',
        'th-fg': '#f3e9d8',
        'th-line': '#3f3528',
      },
    },
  },
}
