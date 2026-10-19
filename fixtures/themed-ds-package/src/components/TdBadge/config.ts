import { defineGranumComponent } from '@feugene/granum/contract'

/** Без `themesDir`: хук со значением по умолчанию в `var()` — теме нечего добавлять. */
export const tdBadgeConfig = defineGranumComponent(import.meta.url, {
  name: 'TdBadge',
})
