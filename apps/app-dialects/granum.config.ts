import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Стенд ветки «другой диалект» (таблица §8 ТЗ движка).
 *
 * `@granum-fixtures/atoms` собран движком словаря `granum-fixtures/atoms@1` — у
 * него своя вселенная имён (`atom-stack`, `atom-gap-2`), и правила для них пакет
 * привозит модулем. Приложение берёт `windEngine()`, то есть словарь
 * `unocss/preset-wind3+granum@66`. Это ДРУГОЙ словарь, и отсюда всё остальное:
 *
 *   - правила пакета не загружаются вовсе (`engine-rules-skipped`): правило,
 *     написанное для чужого словаря, в этой сборке значит не то, что значило;
 *   - списку классов манифеста granum не верит и пересчитывает его своим
 *     движком;
 *   - имена, которых словарь приложения не знает, уезжают в `lost`, остаются во
 *     входе движка и видны в `unmatched` — вместо того, чтобы молча исчезнуть.
 *
 * Обратная сторона той же монеты — `app-atoms`: там движок и пакет говорят на
 * одном словаре, и пересчёта нет.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/atoms'],
  components: ['@granum-fixtures/atoms:AtBox'],
  appSources: { dirs: ['src'] },
})
