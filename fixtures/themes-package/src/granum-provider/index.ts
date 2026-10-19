import { defineGranumProvider } from '@feugene/granum/contract'

export const PROVIDER_ID = '@granum-fixtures/themes'

/**
 * Владелец тем без компонентов: реестр токенов, каталог из двух тем и
 * тема-независимые формулы. `ink` в исходниках — только отличия от `paper`:
 * полные данные собирает сборка провайдера.
 */
export const themesProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 2,
  components: [],
  theme: {
    tokensCss: 'styles/tokens.css',
    registry: 'themes/registry.json',
    defaultTheme: 'paper',
    catalog: {
      paper: { title: 'Бумага', docs: 'https://example.com/themes/paper', data: 'themes/paper.json' },
      ink: { title: 'Чернила', description: 'Тёмные чернила на той же бумаге.', extends: 'paper', data: 'themes/ink.json' },
    },
  },
})

export default themesProvider
