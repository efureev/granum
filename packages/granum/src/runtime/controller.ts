import type { GranumModeEntry, GranumThemeManifest } from './manifest'
import { resolveThemeActivation } from './manifest'

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
  /** Куда применять режим. По умолчанию `document.documentElement`. */
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
   *   - имя режима — его;
   *   - `'auto'` (по умолчанию) — пара, уже выставленная на корне (серверный
   *     HTML, ранний скрипт), иначе сохранённый режим, иначе системная схема —
   *     первый режим с подходящим `colorScheme`, иначе `defaultMode`.
   */
  initial?: string | 'auto'
  /**
   * Как узнать системную схему. По умолчанию
   * `matchMedia('(prefers-color-scheme: dark)')`. Вызывается один раз при
   * создании контроллера — на изменения схемы контроллер не подписывается:
   * это решение приложения, и оно всегда может вызвать `setMode()` само.
   */
  prefersDark?: () => boolean
}

export interface GranumThemeController {
  /** Активная тема сборки — только чтение. */
  readonly theme: GranumThemeManifest['theme']
  /** Текущий режим. */
  readonly mode: string
  /** Режимы в порядке манифеста. */
  modes: () => readonly GranumModeEntry[]
  /**
   * Переключить режим: атрибут на корне + сохранение + уведомление подписчиков.
   * `persist: false` — применить без записи в хранилище: режим вслед за
   * системной схемой или за сменой в другой вкладке не должен становиться
   * выбором пользователя.
   */
  setMode: (name: string, options?: { readonly persist?: boolean }) => void
  /** Следующий режим по кругу — удобно для одной кнопки. */
  cycle: () => string
  /** Подписка на смену режима. Возвращает функцию отписки. */
  subscribe: (listener: (mode: string) => void) => () => void
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
 * Контроллер режимов активной темы поверх манифеста сборки (RT-1).
 *
 * Значения всех режимов уже в CSS — контроллер лишь выставляет пару в атрибут
 * корня. Хранит он имя режима, а не пару: смена темы на сборке не сбрасывает
 * выбор пользователя.
 *
 * ```ts
 * import manifest from 'virtual:granum/themes'
 * import { createThemeController } from '@feugene/granum/runtime'
 *
 * const themes = createThemeController(manifest)
 * themes.modes()          // [{ name: 'light', … }, { name: 'dark', … }]
 * themes.setMode('dark')  // <html data-theme="slate-dark">
 * ```
 */
export function createThemeController(
  manifest: GranumThemeManifest,
  options: GranumThemeControllerOptions = {},
): GranumThemeController {
  if (!manifest || manifest.modes.length === 0)
    throw new Error('createThemeController: the manifest has no modes — the build contains no theme.')

  const byName = new Map(manifest.modes.map(mode => [mode.name, mode]))
  const target = options.target ?? defaultTarget()
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const storageKey = options.storageKey ?? DEFAULT_THEME_STORAGE_KEY
  const attribute = manifest.activation.attribute
  const listeners = new Set<(mode: string) => void>()

  const entry = (name: string): GranumModeEntry => {
    const found = byName.get(name)
    if (!found) {
      throw new Error(
        `createThemeController: mode '${name}' is not in the build of theme '${manifest.theme.id}'. `
        + `Available: ${manifest.modes.map(m => m.name).join(', ')}. `
        + `The mode set is controlled by 'modes.names' and 'modes.define' of granum.config.`,
      )
    }
    return found
  }

  const apply = (name: string): void => {
    target?.setAttribute(attribute, entry(name).value)
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
  const writeStored = (name: string): void => {
    try {
      storage?.setItem(storageKey, name)
    }
    catch {}
  }

  const pickInitial = (): { name: string, applied: boolean } => {
    const requested = options.initial ?? 'auto'
    if (requested !== 'auto')
      return { name: requested, applied: false }

    // Пара уже на корне: контроллер узнаёт её и корень не трогает (RT-5).
    const present = resolveThemeActivation(manifest, target?.getAttribute(attribute))
    if (present)
      return { name: present.name, applied: true }

    const stored = readStored()
    if (stored && byName.has(stored))
      return { name: stored, applied: false }

    const scheme = (options.prefersDark ?? defaultPrefersDark)() ? 'dark' : 'light'
    const bySystem = manifest.modes.find(mode => mode.colorScheme === scheme)
    return { name: bySystem?.name ?? manifest.defaultMode, applied: false }
  }

  const initial = pickInitial()
  let current = initial.name
  if (!initial.applied)
    apply(current)

  return {
    theme: manifest.theme,
    get mode() {
      return current
    },
    modes: () => manifest.modes,

    setMode(name, setOptions) {
      apply(name)
      current = name
      if (setOptions?.persist !== false)
        writeStored(name)
      for (const listener of listeners)
        listener(name)
    },

    cycle() {
      const names = manifest.modes.map(mode => mode.name)
      const next = names[(names.indexOf(current) + 1) % names.length]!
      this.setMode(next)
      return next
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}
