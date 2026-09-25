import { defineGranumProvider } from '@feugene/granum/contract'
// <granum:components:imports>
import { xxBadgeConfig } from '../components/XxBadge/config.ts'
import { xxCardConfig } from '../components/XxCard/config.ts'
// </granum:components:imports>

export const PROVIDER_ID = '@granum-fixtures/mini-ds'

/**
 * Миниатюрная дизайн-система: фундамент (токены, база, две темы) и два
 * компонента. Пути темы — относительно корня раскладки `dist`; исходники
 * лежат зеркально в `src/styles/`, копирует их плагин сборки.
 */
export const miniDsProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 1,
  components: [
    // <granum:components:registry>
    xxBadgeConfig,
    xxCardConfig,
    // </granum:components:registry>
  ],
  theme: {
    tokensCss: 'styles/tokens.css',
    baseCss: 'styles/base.css',
    themes: {
      light: 'styles/themes/light.css',
      dark: 'styles/themes/dark.css',
    },
    defaultThemes: ['light'],
  },
})

export default miniDsProvider
