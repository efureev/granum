import { defineGranumProvider } from '@feugene/granum/contract'
import { atomsRules } from './engine.ts'
// <granum:components:imports>
import { atBoxConfig } from '../components/AtBox/config.ts'
import { atChipConfig } from '../components/AtChip/config.ts'
// </granum:components:imports>

export const PROVIDER_ID = '@granum-fixtures/atoms'

/**
 * Пакет на своём словаре утилит. `engine.dialect` — утверждение о нём: сборка
 * сверит его с диалектом движка, которым её запустили, и не позволит записать в
 * манифест чужой (C-E2, INV-ENG-10).
 */
export const atomsProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 1,
  engine: { dialect: 'granum-fixtures/atoms@1', rules: atomsRules },
  components: [
    // <granum:components:registry>
    atBoxConfig,
    atChipConfig,
    // </granum:components:registry>
  ],
  theme: {
    tokensCss: 'styles/tokens.css',
    themes: { light: 'styles/light.css' },
    defaultThemes: ['light'],
  },
})

export default atomsProvider
