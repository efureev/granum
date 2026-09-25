import { defineGranumProvider } from '@feugene/granum/contract'
import { xhListConfig } from '../components/data/XhList/config.ts'
import { xhTableConfig } from '../components/data/XhTable/config.ts'
import { xhAlertConfig } from '../components/XhAlert/config.ts'
import { xhButtonConfig } from '../components/XhButton/config.ts'
import { xhCardConfig } from '../components/XhCard/config.ts'
import { xhOverlayConfig } from '../components/XhOverlay/config.ts'
import { xhPanelConfig } from '../components/XhPanel/config.ts'

export const PROVIDER_ID = '@granum-fixtures/heavy'

/**
 * Провайдер с пакетным фундаментом: tokens/base/темы. Пути — относительно
 * корня раскладки `dist`; исходники лежат зеркально в `src/theme/` (§6.3).
 */
export const heavyProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 1,
  components: [xhCardConfig, xhButtonConfig, xhAlertConfig, xhOverlayConfig, xhPanelConfig, xhTableConfig, xhListConfig],
  theme: {
    baseCss: 'theme/base.css',
    tokensCss: 'theme/tokens.css',
    themes: { light: 'theme/light.css', dark: 'theme/dark.css' },
    defaultThemes: ['light'],
  },
})

export default heavyProvider
