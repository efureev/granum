import type { GranumModeEntry, GranumThemeManifest, GranumThemeManifestEntry, GranumThemeSelection, GranumThemeSelectionInput } from './manifest'
import type { GranumSheetDocument } from './sheets'
import { carryThemeMode, defaultTheme, findTheme, isSelectableTheme, readThemeSelection, resolveThemeActivation, themeSelectionKey } from './manifest'
import { loadThemeSheet } from './sheets'

/**
 * Минимум от DOM-элемента, который нужен контроллеру. Структурный тип, а не
 * `HTMLElement`: пакет не зависит от `lib.dom`, а тесты подставляют заглушку.
 */
export interface GranumThemeTarget {
  getAttribute: (name: string) => string | null
  setAttribute: (name: string, value: string) => void
}

/** Минимум от `localStorage`. */
export interface GranumThemeStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export interface GranumThemeControllerOptions {
  /** Куда применять выбор. По умолчанию `document.documentElement`. */
  target?: GranumThemeTarget
  /**
   * Где запоминать выбор пользователя. По умолчанию `localStorage`, если он
   * доступен; `null` — не запоминать. Для SSR — `createCookieStorage()`.
   */
  storage?: GranumThemeStorage | null
  /** Ключ хранилища. По умолчанию `granum-theme`. */
  storageKey?: string
  /**
   * Что включить на старте:
   *   - имя режима — его в основной теме;
   *   - `'auto'` (по умолчанию) — пара, уже выставленная на корне (серверный
   *     HTML, ранний скрипт), иначе сохранённый выбор, иначе системная схема —
   *     первый режим основной темы с подходящим `colorScheme`, иначе её режим
   *     по умолчанию;
   *   - `{ theme?, mode? }` — выбор, который сервер прочитал из cookie. Явный
   *     выбор в хранилище не пишется.
   */
  initial?: string | 'auto' | GranumThemeSelectionInput
  /**
   * Как узнать системную схему. По умолчанию
   * `matchMedia('(prefers-color-scheme: dark)')`. Вызывается один раз при
   * создании контроллера — на изменения схемы контроллер не подписывается:
   * это решение приложения, и оно всегда может вызвать `setMode()` само.
   */
  prefersDark?: () => boolean
  /** Документ для листов дополнительных тем. По умолчанию глобальный `document`. */
  document?: GranumSheetDocument
}

/** Текущий выбор: id темы и имя режима. */
export interface GranumThemeState {
  readonly theme: string
  readonly mode: string
}

export interface GranumThemeController {
  /** Текущая тема — запись манифеста. */
  readonly theme: GranumThemeManifestEntry
  /** Текущий режим. */
  readonly mode: string
  /** Применён ли первый выбор: для дополнительной темы — после загрузки её листа. */
  readonly ready: Promise<void>
  /** Темы сборки в порядке манифеста. */
  themes: () => readonly GranumThemeManifestEntry[]
  /** Режимы текущей темы в порядке манифеста. */
  modes: () => readonly GranumModeEntry[]
  /**
   * Переключить режим текущей темы: атрибут на корне + сохранение +
   * уведомление подписчиков. `persist: false` — применить без записи в
   * хранилище: режим вслед за системной схемой или за сменой в другой вкладке
   * не должен становиться выбором пользователя.
   */
  setMode: (name: string, options?: { readonly persist?: boolean }) => void
  /**
   * Переключить тему: сначала загрузить её лист, потом поставить пару. Режим —
   * `mode`, иначе одноимённый текущему, иначе первый той же схемы, иначе режим
   * по умолчанию темы.
   */
  setTheme: (id: string, options?: { readonly mode?: string, readonly persist?: boolean }) => Promise<void>
  /** Следующий режим текущей темы по кругу — удобно для одной кнопки. */
  cycle: () => string
  /** Подписка на смену темы или режима. Возвращает функцию отписки. */
  subscribe: (listener: (state: GranumThemeState) => void) => () => void
}

export const DEFAULT_THEME_STORAGE_KEY = 'granum-theme'

function defaultTarget(): GranumThemeTarget | undefined {
  const doc = (globalThis as { document?: { documentElement?: GranumThemeTarget } }).document
  return doc?.documentElement
}

function defaultStorage(): GranumThemeStorage | null {
  try {
    return (globalThis as { localStorage?: GranumThemeStorage }).localStorage ?? null
  }
  catch {
    // Доступ к localStorage может бросать (Safari в приватном режиме, iframe
    // с чужим origin) — это не повод падать при старте приложения.
    return null
  }
}

function defaultPrefersDark(): boolean {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia
  return mm ? mm('(prefers-color-scheme: dark)').matches : false
}

/**
 * Контроллер темы и режима поверх манифеста сборки.
 *
 * Значения основной темы уже в CSS, дополнительной — в её листе: контроллер
 * загружает лист, если нужно, и выставляет пару в атрибут корня. Хранит он
 * не пару, а ключ выбора (`themeSelectionKey`): шаблон пары может смениться.
 *
 * ```ts
 * import manifest from 'virtual:granum/themes'
 * import { createThemeController } from '@feugene/granum/runtime'
 *
 * const themes = createThemeController(manifest)
 * themes.setMode('dark')       // <html data-theme="slate-dark">
 * await themes.setTheme('clay') // лист clay, затем <html data-theme="clay-dark">
 * ```
 */
export function createThemeController(
  manifest: GranumThemeManifest,
  options: GranumThemeControllerOptions = {},
): GranumThemeController {
  const main = manifest ? defaultTheme(manifest) : undefined
  if (!main || main.modes.length === 0)
    throw new Error('createThemeController: the manifest has no modes — the build contains no theme.')

  const target = options.target ?? defaultTarget()
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const storageKey = options.storageKey ?? DEFAULT_THEME_STORAGE_KEY
  const attribute = manifest.activation.attribute
  const listeners = new Set<(state: GranumThemeState) => void>()
  const sheetOptions = options.document !== undefined ? { document: options.document } : {}

  const themeEntry = (id: string): GranumThemeManifestEntry => {
    const found = findTheme(manifest, id)
    if (!found)
      throw new Error(`createThemeController: theme '${id}' is not in the build. Themes: ${manifest.themes.map(t => t.id).join(', ')}. The build themes are listed in 'themes' of granum.config.`)
    return found
  }

  const modeEntry = (theme: GranumThemeManifestEntry, name: string): GranumModeEntry => {
    const found = theme.modes.find(mode => mode.name === name)
    if (!found) {
      throw new Error(
        `createThemeController: mode '${name}' is not in the build of theme '${theme.id}'. `
        + `Available: ${theme.modes.map(m => m.name).join(', ')}. `
        + `The mode set is controlled by the 'modes' of its entry in 'themes' of granum.config.`,
      )
    }
    return found
  }

  // Хранилище бросает и на записи (Safari в приватном режиме, квота): выбор
  // тогда просто не запоминается.
  const readStored = (): string | null => {
    try {
      return storage?.getItem(storageKey) ?? null
    }
    catch {
      return null
    }
  }
  const writeStored = (selection: GranumThemeSelection): void => {
    try {
      storage?.setItem(storageKey, themeSelectionKey(manifest, selection.theme.id, selection.mode.name))
    }
    catch {}
  }

  const pickInitial = (): { selection: GranumThemeSelection, applied: boolean } => {
    const requested = options.initial ?? 'auto'
    if (typeof requested === 'object') {
      const theme = requested.theme === undefined ? main : themeEntry(requested.theme)
      return { selection: { theme, mode: modeEntry(theme, requested.mode ?? theme.defaultMode) }, applied: false }
    }
    if (requested !== 'auto')
      return { selection: { theme: main, mode: modeEntry(main, requested) }, applied: false }

    // Пара уже на корне: контроллер узнаёт её и корень не трогает.
    const present = resolveThemeActivation(manifest, target?.getAttribute(attribute))
    if (present)
      return { selection: present, applied: true }

    // Дополнительная тема без адреса листа (манифест до сборки) не выбирается:
    // пару без листа контроллер не ставит, как и ранний скрипт.
    const stored = readThemeSelection(manifest, readStored(), theme => isSelectableTheme(manifest, theme))
    if (stored)
      return { selection: stored, applied: false }

    const scheme = (options.prefersDark ?? defaultPrefersDark)() ? 'dark' : 'light'
    const mode = main.modes.find(entry => entry.colorScheme === scheme) ?? modeEntry(main, main.defaultMode)
    return { selection: { theme: main, mode }, applied: false }
  }

  const initial = pickInitial()
  let current = initial.selection
  /** Номер последнего запроса: ответ на устаревший `setTheme` пару не ставит. */
  let generation = 0
  /**
   * Первый выбор — дополнительная тема, и её лист ещё грузится. Пока так, пару
   * не ставит никто: `setMode` лишь запоминает режим, загрузка поставит
   * последний, а ошибка вернёт основную тему. Снимает ожидание загрузка или
   * `setTheme` — выбор другой темы.
   */
  let awaitingSheet = current.theme.id !== main.id

  const notify = (): void => {
    for (const listener of listeners)
      listener({ theme: current.theme.id, mode: current.mode.name })
  }

  const commit = (selection: GranumThemeSelection, persist: boolean): void => {
    target?.setAttribute(attribute, selection.mode.value)
    current = selection
    if (persist)
      writeStored(selection)
    notify()
  }

  // Основная тема применяется сразу: её блоки уже в общем листе. Дополнительной
  // пару ставит загрузка листа; пару, выставленную раньше контроллера, тоже
  // держит лист — ссылку скрипта или сервера загрузчик находит и не дублирует.
  if (!initial.applied && !awaitingSheet)
    target?.setAttribute(attribute, current.mode.value)
  const ready = loadThemeSheet(manifest, current.theme.id, sheetOptions).then(
    () => {
      if (!awaitingSheet)
        return
      awaitingSheet = false
      if (target?.getAttribute(attribute) !== current.mode.value)
        target?.setAttribute(attribute, current.mode.value)
    },
    (error: unknown) => {
      // Лист не загрузился — остаёмся в основной теме: пара без листа дала бы
      // её значения под чужим именем.
      if (awaitingSheet) {
        awaitingSheet = false
        current = { theme: main, mode: carryThemeMode(main, current.mode) }
        target?.setAttribute(attribute, current.mode.value)
        notify()
      }
      throw error
    },
  )
  // Отказ уже обработан выше; без подписчика он не должен шуметь в консоли.
  ready.catch(() => {})

  return {
    get theme() {
      return current.theme
    },
    get mode() {
      return current.mode.name
    },
    ready,
    themes: () => manifest.themes,
    modes: () => current.theme.modes,

    setMode(name, setOptions) {
      // Имя проверяется до любых перемен: неверный вызов не отменяет загрузку.
      const selection = { theme: current.theme, mode: modeEntry(current.theme, name) }
      generation++
      if (awaitingSheet) {
        current = selection
        if (setOptions?.persist !== false)
          writeStored(selection)
        notify()
        return
      }
      commit(selection, setOptions?.persist !== false)
    },

    async setTheme(id, setOptions) {
      const theme = themeEntry(id)
      const mode = carryThemeMode(theme, current.mode, setOptions?.mode)
      awaitingSheet = false
      const request = ++generation
      await loadThemeSheet(manifest, theme.id, sheetOptions)
      if (request !== generation)
        return
      commit({ theme, mode }, setOptions?.persist !== false)
    },

    cycle() {
      const names = current.theme.modes.map(mode => mode.name)
      const next = names[(names.indexOf(current.mode.name) + 1) % names.length]!
      this.setMode(next)
      return next
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}
