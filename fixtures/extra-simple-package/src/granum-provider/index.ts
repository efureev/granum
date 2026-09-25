import { defineGranumProvider } from '@feugene/granum/contract'
import { xgQuickConfig } from '../components/XgQuick/config.ts'
import { xTokenizedLevel2Config } from '../components/XTokenizedLevel2/config.ts'

export const PROVIDER_ID = '@granum-fixtures/extra-simple'

/** Донор объявлен по id (C-4): приложение подключит его манифест само. */
export const extraSimpleProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 1,
  components: [xgQuickConfig, xTokenizedLevel2Config],
  dependencies: ['@granum-fixtures/simple'],
})

export default extraSimpleProvider
