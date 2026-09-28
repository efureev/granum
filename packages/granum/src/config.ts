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
  /**
   * Отдельный ассет на слой вместо одного файла. По умолчанию `false`.
   *
   * Один файл жмётся лучше, но инвалидируется целиком: правка разметки
   * приложения сбрасывает кеш токенов и тем, которые не менялись. При `true`
   * каждый непустой слой уезжает своим ассетом с собственным хешем, а `<link>`
   * на них проставляются в порядке слоёв, так что каскад сохраняется (A-21).
   *
   * Работает только на сборке и только там, где есть HTML-точка входа: ссылки
   * проставляются в неё. В dev-режиме CSS по-прежнему приходит одним
   * виртуальным модулем — хешированных ассетов там нет вовсе.
   */
  readonly split?: boolean
}

export interface GranumJsOptions {
  /** Отдавать `virtual:granum/components`. По умолчанию `true`. */
  readonly virtualComponents?: boolean
  /**
   * Куда писать объявления для `virtual:granum/components` (путь от корня
   * проекта, например `src/granum.d.ts`). По умолчанию не пишутся.
   *
   * Имена реэкспортов зависят от селекции, а значит от конфига приложения, и
   * амбиентным `d.ts` из пакета выражены быть не могут — как и у авто-импорта
   * с его `components.d.ts`. Файл перезаписывается, когда меняется селекция;
   * его место — в гите, рядом с исходниками.
   */
  readonly dts?: string
  /** Импорт компонента вне селекции: ошибка (по умолчанию), предупреждение или молчание (A-6). */
  readonly guard?: 'error' | 'warn' | 'off'
}

export interface GranumReportOptions {
  /** Имя файла отчёта в `outDir`; `false` — не писать. По умолчанию `granum-report.json`. */
  readonly file?: string | false
  /**
   * Считать ли размеры слоёв в brotli. По умолчанию `false`.
   *
   * Цена меры: brotli качества 11 на 222 kB CSS дизайн-системы — 151 мс против
   * 2 мс у gzip, и считается оно на каждый слой дважды (эмиссия и бандл). Платить
   * это на каждой сборке за число, которое смотрят раз в месяц, незачем — поэтому
   * по умолчанию в отчёте только raw и gzip, а `brotli: true` включается тогда, когда
   * вес действительно считают.
   */
  readonly brotli?: boolean
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
