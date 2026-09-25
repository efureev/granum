import { defineGranumProvider } from '@feugene/granum/contract'
// <granum:components:imports>
import { xgQuickConfig } from '../components/XgQuick/config.ts'
import { xTokenizedLevel2Config } from '../components/XTokenizedLevel2/config.ts'
// </granum:components:imports>

export const PROVIDER_ID = '@granum-fixtures/extra-simple'

/** Донор объявлен по id (C-4): приложение подключит его манифест само. */
export const extraSimpleProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 1,
  components: [
    // <granum:components:registry>
    xgQuickConfig,
    xTokenizedLevel2Config,
    // </granum:components:registry>
  ],
  dependencies: ['@granum-fixtures/simple'],
})

export default extraSimpleProvider
