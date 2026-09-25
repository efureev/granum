import { defineGranumComponent } from '@feugene/granum/contract'

/** Группа `groupA`: общий SFC `groupA/shared/*` уезжает в `groups/groupA/shared/`. */
export const xGroupAOneConfig = defineGranumComponent(import.meta.url, {
  name: 'XGroupAOne',
  group: 'groupA',
})
