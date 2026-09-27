/**
 * `@feugene/granum-engine-wind` — движок утилит для granum (E-8).
 *
 * Пакет отдаёт одну фабрику: приложение создаёт инстанс и передаёт его в
 * `granum.config`, провайдер — в `granumProvider({ engine })`. Ядро granum
 * реализации движка не содержит вовсе (INV-ENG-9), поэтому выбор словаря и его
 * настройка целиком здесь.
 */
export { extractWindClasses } from './extract'
export { WIND_DIALECT_BASE, WIND_DIALECT_EXTRA, WIND_UPSTREAM_VERSION, windEngine } from './wind'
export type { WindEngineOptions } from './wind'
