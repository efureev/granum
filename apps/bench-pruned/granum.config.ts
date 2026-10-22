import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Тот же стенд, что `bench-one`, с одним отличием: обрезка токенов включена.
 * Пара `bench-one` → `bench-pruned` и есть измерение эффекта обрезки; всё
 * остальное в обеих сборках обязано совпадать. Обрезка — умолчание (ADR-14), но
 * строка остаётся: разница пары видна в самих конфигах.
 *
 * `appSources` здесь не декорация: granum видит компоненты провайдера по
 * манифестам и НЕ видит разметку приложения. Токен, который приложение взяло
 * само, без этой строки уедет из CSS при зелёной сборке.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/heavy'],
  components: ['@granum-fixtures/heavy:XhPanel'],
  themes: [{ theme: 'heavy', modes: ['light', 'dark'] }],
  appSources: { dirs: ['src'] },
  pruneTokens: { mode: 'on' },
})
