/**
 * Типы контракта провайдера granum, версия 2. Только данные: ни FS,
 * ни зависимостей, ни импортов из node-слоёв.
 */
import type { GranumPreflight, GranumRule, GranumVariant } from '../engine/types'

/** Версия контракта провайдера, поддерживаемая этим пакетом. */
export const GRANUM_CONTRACT_VERSION = 2 as const
/**
 * `1` допустим только у провайдера без каталога тем и без `themesDir`: так
 * читается манифест формата 2 спутника, которому смена контракта тем не нужна.
 */
export type GranumContractVersion = typeof GRANUM_CONTRACT_VERSION | 1

/**
 * Формы записи зависимости компонента:
 *   1. `'Name'` — компонент ТОГО ЖЕ провайдера;
 *   2. `'providerId:Name'` — квалифицированная ссылка (разделитель — последнее
 *      двоеточие);
 *   3. `{ provider, components }` — несколько компонентов одного провайдера.
 */
export type GranumComponentDependency
  = | string
    | { readonly provider: string, readonly components: readonly string[] }

/** Набор токенов под одним селектором. Ключи БЕЗ префикса `--`. */
export interface GranumTokenSet {
  /** Селектор блока; по умолчанию `:root`. */
  readonly selector?: string
  readonly tokens: Readonly<Record<string, string>>
}

/**
 * Ссылка на CSS с одним плоским блоком токенов: `modes.define[*].tokensRef`
 * приложения. Читается на сборке строго.
 */
export interface GranumTokenRef {
  /** Абсолютный URL после `define*`-хелперов; во вводе допустим относительный путь. */
  readonly url: string
  /** Какой блок извлечь. Без него файл обязан содержать один плоский блок. */
  readonly selector?: string
  /** Строгий разбор: нет селектора или вложенность — ошибка. По умолчанию `true`. */
  readonly strict?: boolean
}

export interface GranumComponentDescriptor<Name extends string = string> {
  /** Уникальное в провайдере имя; одновременно имя директории `components/<Name>/`. */
  readonly name: Name
  /**
   * Компоненты, чей код этот компонент реально импортирует. Импорт
   * константы, типа или хелпера из чужой директории зависимостью не является.
   */
  readonly dependencies?: readonly GranumComponentDependency[]
  /**
   * Собственные классы компонента, которые собираются в JS в рантайме и
   * статически не извлекаются. Литеральные классы шаблона сюда не
   * пишутся: сборка провайдера извлечёт их сама.
   */
  readonly safelist?: readonly string[]
  /**
   * Токены, имена которых собираются в рантайме (`` `var(${name})` ``). БЕЗ
   * `--`, допускается `*` в конце. Обрезка их не удаляет, пока
   * компонент в сборке.
   */
  readonly dynamicTokens?: readonly string[]
  /**
   * Хуки: токены, которые компонент читает только через `var(--x, запасное)`, а
   * задать их вправе тема или приложение. БЕЗ `--`, допускается `*` в конце.
   * Объявление снимает находку `token-fallback-only`: запасное значение — норма,
   * а не недосмотр.
   */
  readonly hookTokens?: readonly string[]
  /**
   * CSS компонента, читаемый как есть. После `defineGranumComponent` — пути
   * относительно корня раскладки пакета (`components/<Name>/<file>`);
   * исходное расположение восстанавливается через {@link sourceUrl}.
   */
  readonly cssFiles?: readonly string[]
  /**
   * Токены компонента по темам: `<dir>/<тема>/root.{json,css}` и
   * `<dir>/<тема>/modes/<режим>.{json,css}`. После `define*` — путь относительно
   * корня раскладки (`components/<Name>/themes`); папку читает сборка
   * провайдера и материализует в манифест.
   */
  readonly themesDir?: string
  /** Группа общих чанков `groups/<g>/shared/`. */
  readonly group?: string
  /**
   * `import.meta.url` модуля `config.ts`, из которого создан дескриптор.
   * Нужен сборке провайдера (`./build`), чтобы найти исходные файлы по
   * root-относительным {@link cssFiles}; на резолюцию не влияет.
   */
  readonly sourceUrl?: string
}

/** Значения режима темы. Ключи токенов — БЕЗ `--`. */
export interface GranumModeData {
  readonly title?: string
  readonly colorScheme: 'light' | 'dark'
  /** Режим той же темы, чьи итоговые токены берутся за основу. */
  readonly extends?: string
  /** При `extends` — только отличия. */
  readonly tokens: Readonly<Record<string, string>>
  /**
   * Значения для браузеров без возможности: блок уходит под
   * `@supports <supports>`. Условие пишется целиком, со скобками:
   * `not (color: color-mix(in oklab, red, red))`.
   */
  readonly fallbacks?: readonly GranumModeFallback[]
}

export interface GranumModeFallback {
  readonly supports: string
  readonly tokens: Readonly<Record<string, string>>
}

/**
 * Тема — дизайн-язык: полный набор значений токенов без селекторов. Один тип
 * для темы провайдера и темы приложения: селекторы назначает приложение из
 * активации режима.
 */
export interface GranumThemeData {
  /** Slug: `/^[a-z][a-z0-9-]*$/`. */
  readonly id: string
  readonly title: string
  readonly description?: string
  /** Абсолютный URL дизайн-системы темы. */
  readonly docs?: string
  /** Режимонезависимые токены. */
  readonly root: Readonly<Record<string, string>>
  /** Имя режима — slug без дефиса `/^[a-z][a-z0-9]*$/`; `root` запрещено. */
  readonly modes: Readonly<Record<string, GranumModeData>>
  /** По умолчанию `light`. */
  readonly defaultMode?: string
  /** CSS режимонезависимого базового уровня (`@font-face` и т. п.) → слой `base`. */
  readonly baseCss?: readonly string[]
  /** granum не интерпретирует: поле уходит в `virtual:granum/themes` как есть. */
  readonly extensions?: Readonly<Record<string, unknown>>
}

/** Запись каталога тем провайдера. */
export interface GranumThemeCatalogEntry {
  readonly title: string
  readonly description?: string
  readonly docs?: string
  /** Родительская тема каталога: её данные дополняют `data` на сборке провайдера. */
  readonly extends?: string
  /** Путь к JSON `GranumThemeData` относительно корня раскладки; у записи с `extends` — только отличия. */
  readonly data: string
}

export interface GranumThemeContribution {
  /** Тема-независимые токены: формулы производных и т. п. → слой `tokens`. */
  readonly tokensCss?: string
  /** Тема-независимые базовые стили (reset/layout) → слой `base`. */
  readonly baseCss?: string
  /** Путь к JSON реестра токенов: `{ "<токен без -->": "root" | "mode" }`. */
  readonly registry?: string
  /** Тема, если приложение не выбрало свою. */
  readonly defaultTheme?: string
  /** Каталог тем: id → запись. */
  readonly catalog?: Readonly<Record<string, GranumThemeCatalogEntry>>
}

/**
 * Правила движка от провайдера в типах granum плюс объявление словаря,
 * против которого они написаны.
 *
 * `dialect` обязателен, если есть хоть одно правило: правило без объявленного
 * словаря нечем проверить, и приложение не узнает, можно ли его исполнять.
 * Провайдер вправе объявить только `dialect` — как утверждение о словаре своих
 * классов; сборка сверит его с диалектом движка, которым её запустили.
 * Отпечаток словаря провайдер не объявляет: это свойство не пакета, а
 * реализации, собравшей его.
 */
export interface GranumEngineContribution {
  readonly dialect?: string
  readonly rules?: readonly GranumRule[]
  readonly variants?: readonly GranumVariant[]
  readonly preflights?: readonly GranumPreflight[]
}

export interface GranumProvider {
  /** Как правило, npm-имя пакета. */
  readonly id: string
  readonly contractVersion: GranumContractVersion
  readonly components: readonly GranumComponentDescriptor[]
  readonly theme?: GranumThemeContribution
  readonly engine?: GranumEngineContribution
  /**
   * Инстанс тянет донора в граф; строка тянет донора, если пакет с этим
   * именем разрешается от каталога зависимого провайдера, иначе остаётся
   * мягким требованием присутствия по id.
   */
  readonly dependencies?: readonly (GranumProvider | string)[]
  /**
   * База раскладки для ОБЪЕКТНОЙ формы (тесты, локальная разработка):
   * абсолютный URL директории с завершающим `/`. У манифестной формы
   * база — директория манифеста, поле не используется.
   */
  readonly baseUrl?: string
}
