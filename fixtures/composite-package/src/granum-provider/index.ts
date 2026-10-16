import { defineGranumProvider } from '@feugene/granum/contract'
// <granum:components:imports>
import { xcButtonConfig } from '../components/XcButton/config.ts'
import { xcListConfig } from '../components/XcList/config.ts'
// </granum:components:imports>

export const PROVIDER_ID = '@granum-fixtures/composite'

/**
 * Составной компонент: `XcList` и его часть `XcListItem`.
 *
 * Часть — не компонент провайдера: ни своего `config.ts`, ни entry, код лежит в
 * чанке родителя. Но subpath у неё свой (`codegen --subcomponents`), и импорт
 * `components/XcListItem` ведёт в модуль `XcList` — как у `GrListItem` ядра
 * granularity.
 */
export const compositeProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 1,
  components: [
    // <granum:components:registry>
    xcButtonConfig,
    xcListConfig,
    // </granum:components:registry>
  ],
})

export default compositeProvider
