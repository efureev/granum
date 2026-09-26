import { defineGranumProvider } from '@feugene/granum/contract'
// <granum:components:imports>
import { plCardConfig } from '../components/PlCard/config.ts'
import { plNoteConfig } from '../components/PlNote/config.ts'
// </granum:components:imports>

export const PROVIDER_ID = '@granum-fixtures/plain'

/**
 * Пакет без утилит: вся отделка — собственный CSS компонентов и токены. Блок
 * `engine` он не объявляет вовсе (C-E3) — объявлять нечего.
 */
export const plainProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 1,
  components: [
    // <granum:components:registry>
    plCardConfig,
    plNoteConfig,
    // </granum:components:registry>
  ],
  theme: {
    tokensCss: 'styles/tokens.css',
    themes: { light: 'styles/light.css' },
    defaultThemes: ['light'],
  },
})

export default plainProvider
