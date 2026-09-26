/**
 * Типы контракта провайдера granum, версия 1 (ТЗ §5). Только данные: ни FS,
 * ни зависимостей, ни импортов из node-слоёв (INV-BND-1, INV-DEP-1).
 */
import type { GranumPreflight, GranumRule, GranumVariant } from '../engine/types'

/** Версия контракта провайдера, поддерживаемая этим пакетом (C-2, INV-CON-3). */
export const GRANUM_CONTRACT_VERSION = 1 as const
export type GranumContractVersion = typeof GRANUM_CONTRACT_VERSION

/**
 * Формы записи зависимости компонента (C-4, SPEC v1 §4.1):
 *   1. `'Name'` — компонент ТОГО ЖЕ провайдера;
 *   2. `'providerId:Name'` — квалифицированная ссылка (разделитель — последнее
 *      двоеточие, INV-SEL-1);
 *   3. `{ provider, components }` — несколько компонентов одного провайдера.
 */
export type GranumComponentDependency
  = | string
    | { readonly provider: string, readonly components: readonly string[] }

/** Набор токенов под одним селектором. Ключи БЕЗ префикса `--` (C-12). */
export interface GranumTokenSet {
  /** Селектор блока; по умолчанию — селектор первого блока темы или `:root`. */
  readonly selector?: string
  readonly tokens: Readonly<Record<string, string>>
}

/**
 * Ссылка на CSS, из которого токены темы читаются на сборке провайдера и
 * материализуются в манифест (C-13). Для объектной формы провайдера ссылку
 * читает node-слой приложения (медленный путь, R-6).
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
  /** Уникальное в провайдере имя; одновременно имя директории `components/<Name>/` (C-3). */
  readonly name: Name
  /**
   * Компоненты, чей код этот компонент реально импортирует (C-9). Импорт
   * константы, типа или хелпера из чужой директории зависимостью не является
   * (C-10).
   */
  readonly dependencies?: readonly GranumComponentDependency[]
  /**
   * Собственные классы компонента, которые собираются в JS в рантайме и
   * статически не извлекаются (C-8). Литеральные классы шаблона сюда не
   * пишутся: сборка провайдера извлечёт их сама.
   */
  readonly safelist?: readonly string[]
  /**
   * Токены, имена которых собираются в рантайме (`` `var(${name})` ``). БЕЗ
   * `--`, допускается `*` в конце (C-14). Обрезка их не удаляет, пока
   * компонент в сборке.
   */
  readonly dynamicTokens?: readonly string[]
  /**
   * CSS компонента, читаемый как есть. После `defineGranumComponent` — пути
   * относительно корня раскладки пакета (`components/<Name>/<file>`, C-11);
   * исходное расположение восстанавливается через {@link sourceUrl}.
   */
  readonly cssFiles?: readonly string[]
  /** Структурные токены компонента по темам (C-12). */
  readonly tokenDefinitions?: Readonly<Record<string, GranumTokenSet>>
  /** Ссылки на CSS с токенами по темам; после `define*` — с абсолютным `url` (C-13). */
  readonly tokenDefinitionsRef?: Readonly<Record<string, GranumTokenRef>>
  /** Группа общих чанков `groups/<g>/shared/` (C-15). */
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
  /** Структурные токены; для темы X имеют приоритет над `themes[X]` (INV-THM-4). */
  readonly tokenDefinitions?: Readonly<Record<string, GranumTokenSet>>
  /** Пакетные ссылки на CSS с токенами; форма ввода — строка или объект. */
  readonly tokenDefinitionsRef?: Readonly<Record<string, GranumTokenRef | string>>
  /** Темы, активируемые, если приложение не задало `themes.names` (INV-THM-1). */
  readonly defaultThemes?: readonly string[]
}

/**
 * Правила движка от провайдера в типах granum (C-7) плюс объявление словаря,
 * против которого они написаны (C-E1, C-E2).
 *
 * `dialect` обязателен, если есть хоть одно правило: правило без объявленного
 * словаря нечем проверить, и приложение не узнает, можно ли его исполнять.
 * Провайдер вправе объявить только `dialect` — как утверждение о словаре своих
 * классов; сборка сверит его с диалектом движка, которым её запустили.
 * Отпечаток словаря провайдер не объявляет: это свойство не пакета, а
 * реализации, собравшей его (C-E2).
 */
export interface GranumEngineContribution {
  readonly dialect?: string
  readonly rules?: readonly GranumRule[]
  readonly variants?: readonly GranumVariant[]
  readonly preflights?: readonly GranumPreflight[]
}

export interface GranumProvider {
  /** Как правило, npm-имя пакета (C-1). */
  readonly id: string
  readonly contractVersion: GranumContractVersion
  readonly components: readonly GranumComponentDescriptor[]
  readonly theme?: GranumThemeContribution
  readonly engine?: GranumEngineContribution
  /** Инстанс тянет донора в граф; строка — мягкое требование присутствия по id (C-4). */
  readonly dependencies?: readonly (GranumProvider | string)[]
  /**
   * База раскладки для ОБЪЕКТНОЙ формы (тесты, локальная разработка):
   * абсолютный URL директории с завершающим `/` (C-6). У манифестной формы
   * база — директория манифеста, поле не используется.
   */
  readonly baseUrl?: string
}
