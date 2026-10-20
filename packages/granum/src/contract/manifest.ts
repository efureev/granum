/**
 * Форма `granum.manifest.json` версии 3 (`docs/manifest.md`).
 * Только типы: писатель и читатель живут в `./node`.
 */

export const GRANUM_MANIFEST_VERSION = 3 as const

/** Запись каталога в манифесте: индекс темы, по которому CLI и отчёт перечисляют темы, не читая данных. */
export interface GranumManifestCatalogEntry {
  readonly title: string
  readonly description?: string
  readonly docs?: string
  readonly extends?: string
  /** Путь к JSON `GranumThemeData` с уже разрешённым `extends`. */
  readonly data: string
  /** Режимы темы: режим по умолчанию первым. */
  readonly modes: readonly string[]
  readonly defaultMode: string
}

export interface GranumManifestTheme {
  readonly tokensCss?: string
  readonly baseCss?: string
  readonly registry?: string
  readonly defaultTheme?: string
  readonly catalog?: Readonly<Record<string, GranumManifestCatalogEntry>>
  /** Все объявленные токены, с `--`, отсортированы. */
  readonly declares?: readonly string[]
}

/** Токены компонента для одной темы: режимонезависимые и по режимам. Ключи без `--`. */
export interface GranumComponentThemeTokens {
  readonly root?: Readonly<Record<string, string>>
  readonly modes: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export interface GranumManifestComponentTokens {
  /** Тема → токены компонента для неё (`themesDir`); темы могут быть из чужого каталога. */
  readonly themes?: Readonly<Record<string, GranumComponentThemeTokens>>
  readonly consumes: readonly string[]
  /**
   * Подмножество `consumes`, значение которого обязан дать кто-то извне:
   * потребляется хотя бы раз без fallback, и сам компонент его не присваивает.
   * Именно это множество проверяет `token-undefined`.
   *
   * Необязательное: манифест без этого поля читается как прежде, и
   * диагностика на нём смотрит весь `consumes`.
   */
  readonly requires?: readonly string[]
  /**
   * Подмножество `consumes`, которое компонент читает только через
   * `var(--x, запасное)` и сам не присваивает. По нему доктор выносит
   * `token-fallback-only`.
   *
   * Необязательное: манифест без поля находки не даёт.
   */
  readonly optional?: readonly string[]
  /** Хуки из `hookTokens` дескриптора, с `--`; допускается `*` в конце. Поля нет — хуков нет. */
  readonly hooks?: readonly string[]
  readonly dynamic: readonly string[]
}

export interface GranumManifestComponent {
  readonly entry: string
  readonly files: readonly string[]
  readonly css: readonly string[]
  readonly group: string | null
  /** Нормализованные ключи: `Name` того же провайдера или `providerId:Name`. */
  readonly dependencies: readonly string[]
  readonly classes: readonly string[]
  readonly safelist: readonly string[]
  readonly tokens: GranumManifestComponentTokens
  readonly hash: string
  /**
   * Части составного компонента: имена подпутей `exports["./components/<Part>"]`,
   * которые ведут в entry этого компонента. Своего модуля у части нет, поэтому
   * guard и селекция судят по ней владельца.
   *
   * Необязательное: манифест без поля читается как «частей нет».
   */
  readonly subcomponents?: readonly string[]
}

/**
 * Движок, которым порождён артефакт. Записывается фактом, а не
 * пожеланием: список классов каждого компонента отфильтрован именно им, и без
 * этой записи приложение не может ни доверять списку, ни объяснить пропуск.
 */
export interface GranumManifestEngine {
  /** Имя словаря либо `null`, если артефакт ни от какого словаря не зависит. */
  readonly dialect: string | null
  /** Отпечаток фактического набора имён; `null` тогда и только тогда, когда `dialect` равен `null`. */
  readonly vocabulary: string | null
  /** Реализация, собравшая пакет. */
  readonly name: string
  /** Версия реализации — только для чтения человеком. */
  readonly version?: string
  /** Путь к ESM-модулю с правилами провайдера относительно манифеста, либо `null`. */
  readonly module: string | null
}

export interface GranumManifestWarning {
  readonly code: string
  readonly component?: string
  readonly [detail: string]: unknown
}

export interface GranumManifest {
  /** `2` — манифест спутника без тем: формат 2 у пакета без тем читается как прежде и приводится к форме 3. */
  readonly granum: typeof GRANUM_MANIFEST_VERSION | 2
  readonly contractVersion: 2 | 1
  readonly id: string
  readonly version: string
  readonly generatedBy: string
  readonly hash: string
  readonly dependencies: readonly string[]
  readonly theme: GranumManifestTheme
  readonly engine: GranumManifestEngine
  readonly components: Readonly<Record<string, GranumManifestComponent>>
  readonly warnings: readonly GranumManifestWarning[]
}

/**
 * Манифест, прочитанный с диска: сам JSON плюс база путей — директория файла.
 * Именно в такой форме манифест попадает в резолвер.
 */
export interface GranumLoadedManifest {
  readonly manifest: GranumManifest
  /** Абсолютный URL директории манифеста, с завершающим `/`. */
  readonly baseUrl: string
}

/** Что принимает резолвер в `providers`: объект контракта или прочитанный манифест. */
export type GranumProviderInput = import('./types').GranumProvider | GranumLoadedManifest

export function isLoadedManifest(input: GranumProviderInput): input is GranumLoadedManifest {
  return typeof (input as GranumLoadedManifest).manifest === 'object'
    && (input as GranumLoadedManifest).manifest !== null
    && typeof (input as GranumLoadedManifest).baseUrl === 'string'
}
