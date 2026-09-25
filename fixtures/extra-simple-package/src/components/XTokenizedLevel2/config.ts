import { defineGranumComponent } from '@feugene/granum/contract'

export const xTokenizedLevel2Config = defineGranumComponent(import.meta.url, {
  name: 'XTokenizedLevel2',
  dependencies: ['@granum-fixtures/simple:XTokenized'],
})
