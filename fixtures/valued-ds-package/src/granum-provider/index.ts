import { defineGranumProvider } from '@feugene/granum/contract'
// <granum:components:imports>
import { vdButtonConfig } from '../components/VdButton/config.ts'
import { vdCardConfig } from '../components/VdCard/config.ts'
import { vdGroupConfig } from '../components/VdGroup/config.ts'
// </granum:components:imports>

export const PROVIDER_ID = '@granum-fixtures/valued-ds'

/**
 * Дизайн-система со своими темами: компоненты объявляют имена токенов, значения
 * дают темы — раздел `components` их исходников (C-40, C-42). Темы — исходниками
 * в каталоге (C-43). Темы по умолчанию нет: основную выбирает приложение.
 */
export const valuedDsProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 2,
  components: [
    // <granum:components:registry>
    vdButtonConfig,
    vdCardConfig,
    vdGroupConfig,
    // </granum:components:registry>
  ],
  theme: {
    registry: 'themes/registry.json',
    catalog: {
      stone: { source: 'themes/stone', ignore: ['notes.json'] },
      moss: { source: 'themes/moss' },
      ember: { source: 'themes/ember' },
    },
  },
})

export default valuedDsProvider
