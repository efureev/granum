import { defineGranumProvider } from '@feugene/granum/contract'
// <granum:components:imports>
import { xxBadgeConfig } from '../components/XxBadge/config.ts'
import { xxCardConfig } from '../components/XxCard/config.ts'
// </granum:components:imports>

export const PROVIDER_ID = '@granum-fixtures/mini-ds'

/**
 * Миниатюрная дизайн-система: фундамент (токены, база, тема `mini` с режимами
 * light и dark) и два компонента. Пути темы — относительно корня раскладки
 * `dist`; исходники лежат зеркально в `src/styles/`, копирует их плагин сборки.
 */
export const miniDsProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 2,
  components: [
    // <granum:components:registry>
    xxBadgeConfig,
    xxCardConfig,
    // </granum:components:registry>
  ],
  theme: {
    tokensCss: 'styles/tokens.css',
    baseCss: 'styles/base.css',
    defaultTheme: 'mini',
    catalog: { mini: { title: 'Mini', data: 'styles/themes/mini.json' } },
  },
})

export default miniDsProvider
