import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'
import { sand } from './src/themes/sand.ts'

/**
 * Три темы одной сборки: две — из пакета, одна — своя.
 *
 * - `paper` — основная (`default: true`): её блоки в общем листе, режим по
 *   умолчанию действует без атрибута, под `:root`.
 * - `ink` — вторая тема того же пакета, `sand` — тема-объект приложения. Обе
 *   дополнительные: каждая своим листом, который рантайм грузит, только когда
 *   тему выбирают, — остальные страницы за неё не платят.
 *
 * Режимы у каждой темы свои; пары всех тем разные (`<тема>-<режим>`).
 * Темы пакета `@granum-fixtures/themes` подключаются по зависимости
 * `@granum-fixtures/themed-ds`: перечислять владельца тем в `providers` не нужно.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/themed-ds'],
  themes: [
    { theme: 'paper', default: true, modes: ['light', 'dark'] },
    { theme: 'ink', modes: ['light', 'dark', 'dim'] },
    { theme: sand, modes: ['light', 'dark'] },
  ],
  appSources: { dirs: ['src'] },
})
