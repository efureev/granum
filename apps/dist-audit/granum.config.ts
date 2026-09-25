import { defineGranumConfig } from '@feugene/granum/vite'

/**
 * Стенд аудита дистрибутива.
 *
 * Пакет `@granum-fixtures/mini-ds` — миниатюрная дизайн-система: два
 * компонента, две темы, десять токенов. Приложение берёт ОДИН компонент, и
 * всё остальное обязано исчезнуть из дистрибутива: код второго компонента —
 * tree-shaking'ом, его классы — селекцией, его токены и мёртвый груз шкалы —
 * обрезкой.
 *
 * Обе темы активны намеренно: обрезка обязана резать объявления в каждом
 * блоке, а не только в теме по умолчанию.
 */
export default defineGranumConfig({
  providers: ['@granum-fixtures/mini-ds'],
  components: ['@granum-fixtures/mini-ds:XxCard'],
  themes: { names: ['light', 'dark'] },
  appSources: { dirs: ['src'] },
  pruneTokens: { mode: 'on' },
})
