/**
 * Форма `granum.manifest.json` версии 2 (ТЗ §7, `docs/manifest.md`).
 * Только типы: писатель и читатель живут в `./node`.
 */
import type { GranumTokenSet } from './types'

export const GRANUM_MANIFEST_VERSION = 2 as const

export interface GranumManifestTheme {
  readonly tokensCss?: string
  readonly baseCss?: string
  readonly themes: Readonly<Record<string, string>>
  readonly defaultThemes: readonly string[]
  readonly tokenDefinitions: Readonly<Record<string, GranumTokenSet>>
  /** Все объявленные токены, с `--`, отсортированы. */
  readonly declares: readonly string[]
}

export interface GranumManifestComponentTokens {
  readonly declares: Readonly<Record<string, GranumTokenSet>>
  readonly consumes: readonly string[]
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
}

/**
 * Движок, которым порождён артефакт (M-E2). Записывается фактом, а не
 * пожеланием: список классов каждого компонента отфильтрован именно им, и без
 * этой записи приложение не может ни доверять списку, ни объяснить пропуск.
 */
export interface GranumManifestEngine {
  /** Имя словаря (E-1) либо `null`, если артефакт ни от какого словаря не зависит. */
  readonly dialect: string | null
  /** Отпечаток фактического набора имён (E-4); `null` тогда и только тогда, когда `dialect` равен `null`. */
  readonly vocabulary: string | null
  /** Реализация, собравшая пакет. */
  readonly name: string
  /** Версия реализации — только для чтения человеком (E-5). */
  readonly version?: string
  /** Путь к ESM-модулю с правилами провайдера относительно манифеста, либо `null` (M-E4). */
  readonly module: string | null
}

export interface GranumManifestWarning {
  readonly code: string
  readonly component?: string
  readonly [detail: string]: unknown
}

export interface GranumManifest {
  readonly granum: typeof GRANUM_MANIFEST_VERSION
  readonly contractVersion: 1
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
 * Манифест, прочитанный с диска: сам JSON плюс база путей — директория файла
 * (INV-LAY-2). Именно в такой форме манифест попадает в резолвер.
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
