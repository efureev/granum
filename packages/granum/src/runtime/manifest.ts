/**
 * Манифест тем — канал между сборкой и рантаймом (T-4).
 *
 * Тема выбирается на сборке: в CSS ровно одна активная тема, её режимы стоят
 * под атрибутом на корне, `data-theme="<тема>-<режим>"` по умолчанию. Значения
 * пар и имя атрибута знает только сборка, а нужны они в браузере — переключать
 * режим и восстанавливать его до первого кадра. Без канала приложение
 * дублировало бы их руками и расходилось бы со сборкой молча: несовпавшее
 * значение атрибута не даёт ни ошибки, ни предупреждения.
 *
 * Модуль browser-safe: только типы и чистые функции.
 */

/** Режим активной темы в манифесте. */
export interface GranumModeEntry {
  readonly name: string
  readonly title?: string
  readonly colorScheme: 'light' | 'dark'
  /** Значение атрибута активации — пара `<тема>-<режим>`. */
  readonly value: string
}

export interface GranumThemeManifest {
  /** Активная тема сборки: только чтение, рантайм её не меняет. */
  readonly theme: { readonly id: string, readonly title: string }
  /** Режимы в порядке блоков CSS: режим по умолчанию первым. */
  readonly modes: readonly GranumModeEntry[]
  readonly defaultMode: string
  readonly activation: { readonly attribute: string }
  /** `extensions` данных темы как есть: granum их не интерпретирует. */
  readonly extensions?: Readonly<Record<string, unknown>>
}

/**
 * Режим по значению атрибута — чтение пары обратно (RT-5): серверный HTML или
 * ранний скрипт уже выставили пару, и контроллер обязан её узнать.
 */
export function resolveThemeActivation(manifest: GranumThemeManifest, value: string | null | undefined): GranumModeEntry | undefined {
  if (value === null || value === undefined)
    return undefined
  return manifest.modes.find(mode => mode.value === value)
}
