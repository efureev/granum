/**
 * Интерфейс движка утилит (ТЗ §9.1). Движок чист: без FS, сети и глобального
 * состояния (INV-ENG-1); каждый класс входа попадает либо в `matched`, либо в
 * `unmatched` (INV-ENG-2). Формы правил уточняются на этапе 2, когда вендорится
 * ядро; до тех пор они непрозрачны.
 */

/** Правило движка в типах granum; форма фиксируется на этапе 2. */
export type GranumRule = unknown
/** Вариант (`hover:`, `odd:`, …) в типах granum; форма фиксируется на этапе 2. */
export type GranumVariant = unknown
/** Preflight движка: CSS, эмитируемый вместе с утилитами. */
export interface GranumPreflight {
  readonly css: string
}
/** Шкалы темы движка (spacing, colors, radius…); переопределяются приложением. */
export type EngineTheme = Readonly<Record<string, unknown>>

export interface EngineInput {
  readonly classes: ReadonlySet<string>
  readonly theme?: EngineTheme
  /** Правила провайдеров и приложения; добавляются ПОСЛЕ встроенных (E-3). */
  readonly rules?: readonly GranumRule[]
  readonly variants?: readonly GranumVariant[]
  readonly preflights?: readonly GranumPreflight[]
}

export interface EngineMatch {
  readonly rule: string
  readonly selector: string
  /** `'builtin'`, id провайдера или `'app'`. */
  readonly source: string
}

export interface EngineOutput {
  /** Только утилиты и их preflights, без `@layer` (E-7). */
  readonly css: string
  readonly matched: ReadonlyMap<string, EngineMatch>
  /** Классы без правила — никогда не отбрасываются молча (INV-DIAG-2). */
  readonly unmatched: readonly string[]
}

export interface GranumEngine {
  readonly name: string
  extract: (code: string, id: string) => ReadonlySet<string>
  generate: (input: EngineInput) => EngineOutput | Promise<EngineOutput>
}
