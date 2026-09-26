/**
 * `@feugene/granum-engine-mini` — движок утилит для granum (E-8).
 *
 * Пакет отдаёт одну фабрику: приложение создаёт инстанс и передаёт его в
 * `granum.config`, провайдер — в `granumProvider({ engine })`. Ядро granum
 * реализации движка не содержит вовсе (INV-ENG-9), поэтому выбор словаря и его
 * настройка целиком здесь.
 */
export { extractMiniClasses } from './extract'
export { MINI_DIALECT_BASE, MINI_DIALECT_EXTRA, MINI_UPSTREAM_VERSION, miniEngine } from './mini'
export type { MiniEngineOptions } from './mini'
