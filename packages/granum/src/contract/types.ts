/**
 * Типы контракта провайдера granum, версия 1. Только данные: ни FS,
 * ни зависимостей, ни импортов из node-слоёв.
 */
import type { GranumPreflight, GranumRule, GranumVariant } from '../engine/types'

/** Версия контракта провайдера, поддерживаемая этим пакетом. */
export const GRANUM_CONTRACT_VERSION = 1 as const
export type GranumContractVersion = typeof GRANUM_CONTRACT_VERSION

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
  /** Селектор блока; по умолчанию — селектор первого блока темы или `:root`. */
  readonly selector?: string
  readonly tokens: Readonly<Record<string, string>>
}

/**
 * Ссылка на CSS, из которого токены темы читаются на сборке провайдера и
 * материализуются в манифест. Для объектной формы провайдера ссылку
 * читает node-слой приложения (медленный путь).
 */
export interface GranumTokenRef {
  /** Абсолютный URL после `define*`-хелперов; во вводе допустим относительный путь. */
  readonly url: string
  /** Какой селектор извлечь. По умолчанию `:root`. */
  readonly selector?: string
  /** Под каким селектором эмитить. По умолчанию — извлечённый. */
  readonly as?: string
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
   * CSS компонента, читаемый как есть. После `defineGranumComponent` — пути
   * относительно корня раскладки пакета (`components/<Name>/<file>`);
   * исходное расположение восстанавливается через {@link sourceUrl}.
   */
  readonly cssFiles?: readonly string[]
  /** Структурные токены компонента по темам. */
  readonly tokenDefinitions?: Readonly<Record<string, GranumTokenSet>>
  /** Ссылки на CSS с токенами по темам; после `define*` — с абсолютным `url`. */
  readonly tokenDefinitionsRef?: Readonly<Record<string, GranumTokenRef>>
  /** Группа общих чанков `groups/<g>/shared/`. */
  readonly group?: string
  /**
   * `import.meta.url` модуля `config.ts`, из которого создан дескриптор.
   * Нужен сборке провайдера (`./build`), чтобы найти исходные файлы по
   * root-относительным {@link cssFiles}; на резолюцию не влияет.
   */
  readonly sourceUrl?: string
}

export interface GranumThemeContribution {
  /** Базовые стили (reset/layout), один раз на сборку. */
  readonly baseCss?: string
  /** Тема-независимые токены. */
  readonly tokensCss?: string
  /** Имя темы → CSS-файл темы. Подключается пересечение с активным набором. */
  readonly themes?: Readonly<Record<string, string>>
  /** Структурные токены; для темы X имеют приоритет над `themes[X]`. */
  readonly tokenDefinitions?: Readonly<Record<string, GranumTokenSet>>
  /** Пакетные ссылки на CSS с токенами; форма ввода — строка или объект. */
  readonly tokenDefinitionsRef?: Readonly<Record<string, GranumTokenRef | string>>
  /** Темы, активируемые, если приложение не задало `themes.names`. */
  readonly defaultThemes?: readonly string[]
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
  /** Инстанс тянет донора в граф; строка — мягкое требование присутствия по id. */
  readonly dependencies?: readonly (GranumProvider | string)[]
  /**
   * База раскладки для ОБЪЕКТНОЙ формы (тесты, локальная разработка):
   * абсолютный URL директории с завершающим `/`. У манифестной формы
   * база — директория манифеста, поле не используется.
   */
  readonly baseUrl?: string
}
