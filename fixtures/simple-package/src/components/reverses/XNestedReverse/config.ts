import { defineGranumComponent } from '@feugene/granum/contract'

/** Раскладка `reverses/<Name>/`: части лежат в соседнем `reverses/parts/`. */
export const xNestedReverseConfig = defineGranumComponent(import.meta.url, {
  name: 'XNestedReverse',
})
