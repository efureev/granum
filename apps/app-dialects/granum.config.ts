import { defineGranumConfig } from '@feugene/granum/vite'
import { miniEngine } from '@feugene/granum-engine-mini'

/**
 * Стенд ветки «другой диалект, наборы разошлись» (таблица §8 ТЗ движка).
 *
 * `@granum-fixtures/heavy` собран движком с доп-правилами — диалект
 * `unocss/preset-mini+granum@66`. Приложение берёт движок без них
 * (`unocss/preset-mini@66`), и это ДРУГОЙ словарь: `divide-y`, `space-x-*` и
 * `tabular-nums` есть только в первом. Поэтому granum не верит списку классов
 * манифеста, а пересчитывает его своим движком и называет разницу: классы,
 * которых его словарь не знает, уезжают в `lost`, остаются во входе движка и
 * видны в `unmatched` — вместо того, чтобы молча исчезнуть.
 */
export default defineGranumConfig({
  engine: miniEngine({ extraRules: false }),
  providers: ['@granum-fixtures/heavy'],
  components: ['@granum-fixtures/heavy:XhList'],
  appSources: { dirs: ['src'] },
})
