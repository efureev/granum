/**
 * Конфиг приложения `granum.config.ts` (ТЗ §10.1). Типы и `defineGranumConfig`
 * — browser-safe; загрузка и валидация формы — в `./vite` и `./node`.
 */
import type { GranumProviderInput } from './contract'
import type { GranumThemesInput } from './core/resolve'
import type { ComponentSelection } from './core/resolveSelection'
import type { GranumEngine } from './engine/types'

export type GranumPruneMode = 'off' | 'report' | 'on'

export interface GranumAppSources {
  /** Директории исходников приложения относительно корня Vite. */
  readonly dirs: readonly string[]
  /** Расширения. По умолчанию код, разметка и CSS приложения. */
  readonly extensions?: readonly string[]
}

export interface GranumPruneTokensOptions {
  readonly mode?: GranumPruneMode
  /** Токены (без `--`), сохраняемые безусловно; строка с `*` в конце — префикс. */
  readonly keep?: readonly (string | RegExp)[]
  readonly keepPrefixes?: readonly string[]
}

export interface GranumCssOptions {
  /** Каскадные слои `@layer` (по умолчанию `true`); `false` — плоская конкатенация в том же порядке (A-14). */
  readonly layers?: boolean
  /** Префикс имён слоёв. По умолчанию `granum`. */
  readonly layerPrefix?: string
  /** Раскрывать `@apply` в CSS провайдеров объектной формы. По умолчанию `false`. */
  readonly expandDirectives?: boolean
}

export interface GranumJsOptions {
  /** Отдавать `virtual:granum/components`. По умолчанию `true`. */
  readonly virtualComponents?: boolean
  /** Импорт компонента вне селекции: ошибка (по умолчанию), предупреждение или молчание (A-6). */
  readonly guard?: 'error' | 'warn' | 'off'
}

export interface GranumReportOptions {
  /** Имя файла отчёта в `outDir`; `false` — не писать. По умолчанию `granum-report.json`. */
  readonly file?: string | false
}

export interface GranumConfig {
  /** Имена пакетов (манифест ищется через `exports`) или объекты контракта / прочитанные манифесты. */
  readonly providers: readonly (string | GranumProviderInput)[]
  /** `'all'`, список или `'imports'` — по импортам в `appSources` (A-3). По умолчанию `'all'`. */
  readonly components?: ComponentSelection | 'imports'
  readonly themes?: GranumThemesInput
  /**
   * Движок утилит — инстанс, а не имя и не опции (A-E1). Выбор реализации и её
   * настройка принадлежат приложению: `windEngine()` из
   * `@feugene/granum-engine-wind` или свой. Правила приложения передаются
   * фабрике движка, у конфига поля для правил нет (E-10).
   */
  readonly engine: GranumEngine
  readonly css?: GranumCssOptions
  readonly appSources?: GranumAppSources
  readonly pruneTokens?: GranumPruneTokensOptions
  readonly js?: GranumJsOptions
  readonly report?: GranumReportOptions
}

/** Типизированный конфиг; форма проверяется плагином при загрузке (A-1). */
export function defineGranumConfig<T extends GranumConfig>(config: T): T {
  return config
}
