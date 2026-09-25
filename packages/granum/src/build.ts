/**
 * Точка входа `./build`: плагин сборки провайдера (ТЗ §6). Node-only, peer `vite`.
 * Реализация — этап 4.
 */
import { notImplemented } from './internal/notImplemented'

export interface GranumProviderPluginOptions {
  /** Понизить `undeclared-dependency` до предупреждения (B-8). */
  readonly dependencyCheck?: 'error' | 'warn'
}

/** Плагин Vite для `vite.config.ts` провайдера: раскладка, извлечение, манифест. */
export function granumProvider(_options: GranumProviderPluginOptions = {}): never {
  return notImplemented('granumProvider', 'stage 4')
}
