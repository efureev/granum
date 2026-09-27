/**
 * Публичный интерфейс движка утилит (ТЗ §9.1). Типы структурные и свои:
 * поверхность `./engine` не ссылается на вендоренный код, а правила
 * провайдеров, написанные против этих типов, структурно совместимы с ним (C-7).
 *
 * Движок чист: без FS, сети и глобального состояния (INV-ENG-1); каждый класс
 * входа попадает либо в `matched`, либо в `unmatched` (INV-ENG-2).
 */

export type GranumCssValue = string | number | undefined
export type GranumCssObject = Readonly<Record<string, GranumCssValue>>
export type GranumCssEntries = readonly (readonly [string, GranumCssValue])[]

/** Шкалы темы движка (`spacing`, `colors`, `borderRadius`…); приложение переопределяет их поверх встроенных. */
export type EngineTheme = Readonly<Record<string, unknown>>

/** Контекст динамического правила — подмножество контекста UnoCSS, достаточное для правил провайдеров. */
export interface GranumRuleContext {
  readonly rawSelector: string
  readonly currentSelector: string
  readonly theme: EngineTheme
  /** Генератор движка; форма непрозрачна, чтобы не протекала в контракт. */
  readonly generator: unknown
  readonly symbols: Readonly<Record<string, symbol>>
}

export type GranumRuleResult
  = | GranumCssObject
    | GranumCssEntries
    | string
    | undefined
    | readonly (GranumCssObject | GranumCssEntries | string | undefined)[]

export interface GranumRuleMeta {
  readonly layer?: string
  readonly autocomplete?: string | readonly string[]
  readonly custom?: Readonly<Record<string, unknown>>
}

export type GranumDynamicRule = readonly [
  RegExp,
  (match: RegExpMatchArray, context: GranumRuleContext) => GranumRuleResult,
  GranumRuleMeta?,
]
export type GranumStaticRule = readonly [string, GranumCssObject | GranumCssEntries, GranumRuleMeta?]
/** Правило движка: динамическое (RegExp + обработчик) или статическое (имя + декларации). */
export type GranumRule = GranumDynamicRule | GranumStaticRule

export interface GranumVariantHandler {
  readonly matcher?: string
  readonly selector?: (input: string) => string | undefined
  readonly parent?: string
  readonly layer?: string
  readonly sort?: number
}
export type GranumVariantFunction = (matcher: string, context: GranumRuleContext) => string | GranumVariantHandler | undefined
export interface GranumVariantObject {
  readonly name?: string
  readonly match: GranumVariantFunction
  readonly multiPass?: boolean
  readonly order?: number
}
/** Вариант (`hover:`, `odd:`, …): функция или объект с `match`. */
export type GranumVariant = GranumVariantFunction | GranumVariantObject

/** Preflight движка: CSS, эмитируемый вместе с утилитами. */
export interface GranumPreflight {
  readonly css: string | ((context: { readonly theme: EngineTheme, readonly generator: unknown }) => string | undefined)
  readonly layer?: string
}

export interface EngineInput {
  readonly classes: ReadonlySet<string>
  readonly theme?: EngineTheme
  /** Правила провайдеров и приложения; добавляются ПОСЛЕ встроенных (E-3). */
  readonly rules?: readonly GranumRule[]
  readonly variants?: readonly GranumVariant[]
  readonly preflights?: readonly GranumPreflight[]
  /** Источник каждого правила/варианта из `rules`/`variants` для `matched.source`: id провайдера или `'app'`. */
  readonly sources?: ReadonlyMap<GranumRule | GranumVariant, string>
}

export interface EngineMatch {
  /** Идентификатор правила: исходник RegExp или имя статического правила. */
  readonly rule: string
  readonly selector: string
  /** `'builtin'`, id провайдера или `'app'`. */
  readonly source: string
  readonly layer: string
}

export interface EngineOutput {
  /** Только утилиты, без `@layer` (E-7). */
  readonly css: string
  /**
   * CSS базового уровня: инициализация кастомных свойств движка, регистрации
   * `@property`, reset — всё, что обязано действовать ДО стилей компонентов, а
   * не после них (E-15).
   *
   * Движок не знает, в какой слой это уедет (E-13): он сообщает род CSS, а место
   * в каскаде выбирает сборщик. Поле необязательное — движок без preflight его
   * не заполняет, и вывод ведёт себя как прежде.
   */
  readonly preflight?: string
  readonly matched: ReadonlyMap<string, EngineMatch>
  /** Классы без правила — никогда не отбрасываются молча (INV-DIAG-2). */
  readonly unmatched: readonly string[]
}

export interface GranumEngine {
  /** Реализация: для диагностики. */
  readonly name: string
  /** Версия реализации. Только для чтения человеком: в решениях не участвует (E-5). */
  readonly version?: string
  /**
   * Имя словаря классов (E-1). По нему грузятся правила провайдеров: правило,
   * написанное для словаря, переживает смену реализации внутри мажора.
   */
  readonly dialect: string
  /**
   * Отпечаток фактического множества генерируемых имён (E-4). По нему решается,
   * верить списку классов манифеста или пересчитать его. Считается
   * `vocabularyFingerprint` либо объявляется движком самостоятельно, если он
   * гарантирует правило изменения сам.
   */
  readonly vocabulary: string
  extract: (code: string, id: string) => ReadonlySet<string>
  generate: (input: EngineInput) => Promise<EngineOutput>
}
