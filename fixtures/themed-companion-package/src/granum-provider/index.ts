import { defineGranumProvider } from '@feugene/granum/contract'
// <granum:components:imports>
import { tcChartConfig } from '../components/TcChart/config.ts'
// </granum:components:imports>

export const PROVIDER_ID = '@granum-fixtures/themed-companion'

/** Спутник: без каталога, токены — для одной темы дизайн-системы (C-35). */
export const themedCompanionProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 2,
  components: [
    // <granum:components:registry>
    tcChartConfig,
    // </granum:components:registry>
  ],
  dependencies: ['@granum-fixtures/themed-ds'],
})

export default themedCompanionProvider
