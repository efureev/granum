import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Без `themesDir`: хук со значением по умолчанию в `var()` — теме нечего добавлять.
 * Хук объявлен: запасное значение здесь норма, а не потерянный токен.
 */
export const tdBadgeConfig = defineGranumComponent(import.meta.url, {
  name: 'TdBadge',
  hookTokens: ['td-badge-bg'],
})
