import { defineGranumConfig } from '@feugene/granum/vite'
import { miniEngine } from '@feugene/granum-engine-mini'

/**
 * Стенд аудита дистрибутива.
 *
 * Пакет `@granum-fixtures/mini-ds` — миниатюрная дизайн-система: два
 * компонента, две темы, десять токенов. Приложение берёт ОДИН компонент, и
 * всё остальное обязано исчезнуть из дистрибутива: код второго компонента —
 * tree-shaking'ом, его классы — селекцией, его токены и мёртвый груз шкалы —
 * обрезкой.
 *
 * Тема одна, светлая: приложение не умеет переключаться, и платить за второй
 * блок ему незачем. Тёмная тема пакета в дистрибутив не попадает целиком —
 * это ещё одна строка аудита, которую видно рядом с обрезкой токенов.
 */
export default defineGranumConfig({
  engine: miniEngine(),
  providers: ['@granum-fixtures/mini-ds'],
  components: ['@granum-fixtures/mini-ds:XxCard'],
  themes: { names: ['light'] },
  appSources: { dirs: ['src'] },
  pruneTokens: { mode: 'on' },
})
