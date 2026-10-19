import { defineGranumProvider } from '@feugene/granum/contract'
// <granum:components:imports>
import { tdBadgeConfig } from '../components/TdBadge/config.ts'
import { tdButtonConfig } from '../components/TdButton/config.ts'
import { tdCardConfig } from '../components/TdCard/config.ts'
// </granum:components:imports>

export const PROVIDER_ID = '@granum-fixtures/themed-ds'

/**
 * Компоненты поверх чужих тем: своего каталога нет, токены компонентов
 * лежат у компонентов по темам владельца. Владелец — строковая зависимость:
 * приложению хватает этого пакета в `providers`, владельца granum подгрузит сам.
 */
export const themedDsProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 2,
  components: [
    // <granum:components:registry>
    tdBadgeConfig,
    tdButtonConfig,
    tdCardConfig,
    // </granum:components:registry>
  ],
  dependencies: ['@granum-fixtures/themes'],
})

export default themedDsProvider
