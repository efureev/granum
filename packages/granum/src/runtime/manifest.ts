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

/** Тема превью (A-32): её пары есть в CSS сборки, но корень она не занимает. */
export interface GranumPreviewEntry {
  readonly theme: { readonly id: string, readonly title: string }
  readonly modes: readonly GranumModeEntry[]
}

export interface GranumThemeManifest {
  /** Активная тема сборки: только чтение, рантайм её не меняет. */
  readonly theme: { readonly id: string, readonly title: string }
  /** Режимы в порядке блоков CSS: режим по умолчанию первым. */
  readonly modes: readonly GranumModeEntry[]
  readonly defaultMode: string
  /**
   * `value` — шаблон пары с `{theme}` и `{mode}` (`modes.activation.value`).
   * Манифест, собранный руками, может его не нести: тогда `{theme}-{mode}`.
   */
  readonly activation: { readonly attribute: string, readonly value?: string }
  /** Темы превью в порядке конфига; без превью поля нет. */
  readonly previews?: readonly GranumPreviewEntry[]
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

/**
 * Пара режима активной темы или темы превью — для острова (`mode`) или превью
 * (`theme`) на поддереве. `undefined`, если такой пары в CSS сборки нет:
 * собранное по шаблону значение не совпало бы ни с одним селектором молча.
 */
export function themeModeValue(manifest: GranumThemeManifest, mode: string, theme: string = manifest.theme.id): string | undefined {
  const modes = theme === manifest.theme.id
    ? manifest.modes
    : manifest.previews?.find(preview => preview.theme.id === theme)?.modes
  return modes?.find(entry => entry.name === mode)?.value
}
