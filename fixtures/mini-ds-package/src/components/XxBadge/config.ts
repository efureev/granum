import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Второй компонент пакета. Приложение-стенд его не берёт: по нему и видно,
 * что tree-shaking выбрасывает код, а селекция — классы и токены.
 */
export const xxBadgeConfig = defineGranumComponent(import.meta.url, {
  name: 'XxBadge',
})
