/**
 * Точка входа `./node`: манифесты, эмиссия CSS, диагностика как функции
 * (ТЗ §7, §12). Node-only, без внешних зависимостей. Реализация — этапы 3–6.
 */
import { notImplemented } from './internal/notImplemented'

export * from './index'

/** Чтение и валидация `granum.manifest.json` по `manifest.md` §4. Этап 3. */
export function readManifest(): never {
  return notImplemented('readManifest', 'stage 3')
}
