/**
 * Манифест тем — канал между сборкой и рантаймом.
 *
 * Темы выбираются на сборке: основная — в общем листе и под `:root`,
 * дополнительные — каждая своим листом. Режим и тему включает пара в атрибуте
 * корня, `data-theme="<тема>-<режим>"` по умолчанию. Значения пар, имя
 * атрибута и адреса листов знает только сборка, а нужны они в браузере —
 * переключать тему и режим и восстанавливать выбор до первого кадра. Без
 * канала приложение дублировало бы их руками и расходилось бы со сборкой
 * молча: несовпавшее значение атрибута не даёт ни ошибки, ни предупреждения.
 *
 * Модуль browser-safe: только типы и чистые функции.
 */
import { DEFAULT_ACTIVATION_ATTRIBUTE, DEFAULT_ACTIVATION_VALUE } from '../core/activation'

/** Режим темы в манифесте. */
export interface GranumModeEntry {
  readonly name: string
  readonly title?: string
  readonly colorScheme: 'light' | 'dark'
  /** Значение атрибута активации — пара `<тема>-<режим>`. */
  readonly value: string
}

/** Тема сборки в манифесте. */
export interface GranumThemeManifestEntry {
  readonly id: string
  readonly title: string
  /** Версия темы из её данных (C-41); у темы без версии нет. */
  readonly version?: string
  /** Режимы в порядке блоков CSS: режим по умолчанию первым. */
  readonly modes: readonly GranumModeEntry[]
  readonly defaultMode: string
  /**
   * Адрес листа дополнительной темы — ассет сборки с хешем. У основной темы
   * его нет: её блоки в общем листе. Нет его и у манифеста, собранного до
   * сборки: адрес ассета тогда ещё неизвестен.
   */
  readonly href?: string
  /** `extensions` данных темы как есть: granum их не интерпретирует. */
  readonly extensions?: Readonly<Record<string, unknown>>
}

export interface GranumThemeManifest {
  /** Темы сборки в порядке конфига. */
  readonly themes: readonly GranumThemeManifestEntry[]
  /** Id основной темы: под `:root`, действует без атрибута. */
  readonly defaultTheme: string
  /**
   * `value` — шаблон пары с `{theme}` и `{mode}` (`activation.value`).
   * Манифест, собранный руками, может его не нести: тогда `{theme}-{mode}`.
   */
  readonly activation: { readonly attribute: string, readonly value?: string }
}

/** Тема и режим, которым принадлежит пара. */
export interface GranumThemeSelection {
  readonly theme: GranumThemeManifestEntry
  readonly mode: GranumModeEntry
}

/** Выбор по именам: без `theme` — основная тема, без `mode` — режим по умолчанию темы. */
export interface GranumThemeSelectionInput {
  readonly theme?: string
  readonly mode?: string
}

/** Пара режима по шаблону активации: `{theme}-{mode}` → `slate-dark`. */
export function themePairValue(template: string, theme: string, mode: string): string {
  return template.replaceAll('{theme}', theme).replaceAll('{mode}', mode)
}

/** Тема сборки по id; без id — основная. */
export function findTheme(manifest: GranumThemeManifest, id: string = manifest.defaultTheme): GranumThemeManifestEntry | undefined {
  return manifest.themes.find(theme => theme.id === id)
}

/** Основная тема сборки. Манифест без неё — ошибка сборки манифеста, а не повод молчать. */
export function defaultTheme(manifest: GranumThemeManifest): GranumThemeManifestEntry {
  const found = findTheme(manifest)
  if (!found)
    throw new Error(`granum: the theme manifest names '${manifest.defaultTheme}' as the default theme, but it is not among its themes: ${manifest.themes.map(theme => theme.id).join(', ') || '—'}.`)
  return found
}

export interface GranumThemeManifestInput {
  /** Темы в порядке манифеста; режим по умолчанию каждой встанет первым. */
  readonly themes: readonly {
    readonly id: string
    readonly title: string
    readonly version?: string
    readonly modes: readonly { readonly name: string, readonly title?: string, readonly colorScheme: 'light' | 'dark' }[]
    readonly defaultMode: string
    readonly href?: string
    readonly extensions?: Readonly<Record<string, unknown>>
  }[]
  /** Основная тема. По умолчанию — первая. */
  readonly defaultTheme?: string
  /** Атрибут и шаблон пары; по умолчанию — как у сборки: `data-theme` и `{theme}-{mode}`. */
  readonly activation?: { readonly attribute?: string, readonly value?: string }
}

/**
 * Манифест тем по описанию — каталогу провайдера или своему списку — тем же
 * правилом пары и тем же порядком, что у сборки. Нужен тому, у кого
 * `virtual:granum/themes` нет: CSS темы подключён готовым файлом, а
 * контроллеру нужны пары.
 */
export function createThemeManifest(input: GranumThemeManifestInput): GranumThemeManifest {
  if (input.themes.length === 0)
    throw new Error('createThemeManifest: no themes — the manifest needs at least the default theme.')
  const attribute = input.activation?.attribute ?? DEFAULT_ACTIVATION_ATTRIBUTE
  const value = input.activation?.value ?? DEFAULT_ACTIVATION_VALUE
  const seen = new Set<string>()
  const themes = input.themes.map((theme): GranumThemeManifestEntry => {
    if (seen.has(theme.id))
      throw new Error(`createThemeManifest: theme '${theme.id}' is listed twice.`)
    seen.add(theme.id)
    if (!theme.modes.some(mode => mode.name === theme.defaultMode))
      throw new Error(`createThemeManifest: default mode '${theme.defaultMode}' of theme '${theme.id}' is not among its modes: ${theme.modes.map(mode => mode.name).join(', ') || '—'}.`)
    const ordered = [...theme.modes].sort((a, b) => Number(b.name === theme.defaultMode) - Number(a.name === theme.defaultMode))
    return {
      id: theme.id,
      title: theme.title,
      ...(theme.version !== undefined ? { version: theme.version } : {}),
      modes: ordered.map(mode => ({
        name: mode.name,
        ...(mode.title !== undefined ? { title: mode.title } : {}),
        colorScheme: mode.colorScheme,
        value: themePairValue(value, theme.id, mode.name),
      })),
      defaultMode: theme.defaultMode,
      ...(theme.href !== undefined ? { href: theme.href } : {}),
      ...(theme.extensions !== undefined ? { extensions: theme.extensions } : {}),
    }
  })
  const main = input.defaultTheme ?? themes[0]!.id
  if (!seen.has(main))
    throw new Error(`createThemeManifest: default theme '${main}' is not among the themes: ${themes.map(theme => theme.id).join(', ')}.`)
  return { themes, defaultTheme: main, activation: { attribute, value } }
}

/**
 * Тема и режим по значению атрибута — чтение пары обратно: серверный HTML или
 * ранний скрипт уже выставили пару, и контроллер обязан её узнать.
 */
export function resolveThemeActivation(manifest: GranumThemeManifest, value: string | null | undefined): GranumThemeSelection | undefined {
  if (value === null || value === undefined)
    return undefined
  for (const theme of manifest.themes) {
    const mode = theme.modes.find(entry => entry.value === value)
    if (mode)
      return { theme, mode }
  }
  return undefined
}

/**
 * Пара режима темы сборки — для острова на поддереве. `undefined`, если такой
 * пары в CSS сборки нет: собранное по шаблону значение не совпало бы ни с
 * одним селектором молча.
 */
export function themeModeValue(manifest: GranumThemeManifest, mode: string, theme: string = manifest.defaultTheme): string | undefined {
  return findTheme(manifest, theme)?.modes.find(entry => entry.name === mode)?.value
}

/**
 * Тему можно выбрать: у неё есть режимы, и это основная или дополнительная с
 * адресом листа — пару без листа не ставит никто, а у темы без режимов пары нет.
 */
export function isSelectableTheme(manifest: GranumThemeManifest, theme: GranumThemeManifestEntry): boolean {
  return theme.modes.length > 0 && (theme.id === manifest.defaultTheme || theme.href !== undefined)
}

/**
 * Режим темы при её смене: `requested`, иначе одноимённый `current`, иначе
 * первый той же схемы, иначе режим по умолчанию темы. `requested`, которого у
 * темы нет, и тема без режимов в сборке — ошибка: ставить нечего.
 */
export function carryThemeMode(theme: GranumThemeManifestEntry, current: GranumModeEntry | undefined, requested?: string): GranumModeEntry {
  if (theme.modes.length === 0)
    throw new Error(`granum: theme '${theme.id}' has no modes in the build — there is no pair to set. Its modes are listed in the 'modes' of its entry in 'themes' of granum.config.`)
  if (requested !== undefined) {
    const found = theme.modes.find(mode => mode.name === requested)
    if (!found)
      throw new Error(`granum: mode '${requested}' is not in the build of theme '${theme.id}'. Available: ${theme.modes.map(m => m.name).join(', ')}.`)
    return found
  }
  return theme.modes.find(mode => mode.name === current?.name)
    ?? theme.modes.find(mode => mode.colorScheme === current?.colorScheme)
    ?? theme.modes.find(mode => mode.name === theme.defaultMode)
    ?? theme.modes[0]!
}

/**
 * Ключ выбора в хранилище: у основной темы — имя режима, у дополнительной —
 * `<тема>-<режим>`. Пару не храним — шаблон может смениться; ключ разбирается
 * однозначно, потому что в имени режима нет дефиса. Режим основной темы без
 * имени темы переживает смену основной темы на сборке.
 */
export function themeSelectionKey(manifest: GranumThemeManifest, theme: string, mode: string): string {
  return theme === manifest.defaultTheme ? mode : `${theme}-${mode}`
}

/**
 * Выбор из хранилища (`themeSelectionKey`): значение без дефиса — режим
 * основной темы, `<тема>-<режим>` — режим этой темы, если она среди
 * `selectable` и режим у неё есть. Иначе выбора нет: решит системная схема.
 */
export function readThemeSelection(
  manifest: GranumThemeManifest,
  stored: string | null | undefined,
  selectable: (theme: GranumThemeManifestEntry) => boolean = () => true,
): GranumThemeSelection | undefined {
  if (!stored)
    return undefined
  const at = stored.lastIndexOf('-')
  const theme = at < 0 ? findTheme(manifest) : findTheme(manifest, stored.slice(0, at))
  if (!theme || (at >= 0 && (theme.id === manifest.defaultTheme || !selectable(theme))))
    return undefined
  const mode = theme.modes.find(candidate => candidate.name === stored.slice(at + 1))
  return mode ? { theme, mode } : undefined
}
