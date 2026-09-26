import { defineGranumComponent } from '@feugene/granum/contract'

/** Класс `atom-frame` даёт правило пакета — без него в CSS не появится рамка. */
export const atBoxConfig = defineGranumComponent(import.meta.url, {
  name: 'AtBox',
})
