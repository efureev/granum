/**
 * Лист дополнительной темы в документе: `<link>` на ассет сборки.
 *
 * Пару темы нельзя ставить раньше, чем загружен её лист: до загрузки элемент
 * получил бы значения основной темы, а при ошибке остался бы в ней навсегда без
 * единого слова. Ссылку ставят скрипт до первого кадра, сервер или этот модуль —
 * и все трое помечают её одним атрибутом, чтобы второй не вставил вторую.
 *
 * Скрипт и этот модуль отмечают ещё и состояние ссылки: у `<link>` нет способа
 * спросить, грузится он или уже упал, а событие, пришедшее до подписки, второй
 * раз не придёт. Без отметки упавшую ссылку ждали бы вечно.
 */
import type { GranumThemeManifest } from './manifest'
import { findTheme } from './manifest'

/** Атрибут ссылки на лист темы: значение — id темы. */
export const THEME_SHEET_ATTRIBUTE = 'data-granum-theme'

/** Состояние ссылки: `loading` при вставке, затем `load` или `error`. */
export const THEME_SHEET_STATE_ATTRIBUTE = 'data-granum-state'

/**
 * Метка листа дополнительной темы — свойство, которое лист регистрирует
 * `@property` с `initial-value: 1`. Лист, подключённый статически, меченой
 * ссылки не имеет, и загрузчик узнаёт его по метке.
 */
export function themeSheetMarker(theme: string): string {
  return `--granum-sheet-${theme}`
}

/** Минимум DOM-ссылки, который нужен загрузчику. */
interface SheetLink {
  rel: string
  href: string
  sheet?: unknown
  setAttribute: (name: string, value: string) => void
  getAttribute?: (name: string) => string | null
  remove?: () => void
  addEventListener: (type: 'load' | 'error', listener: () => void, options?: { once?: boolean }) => void
}

/** Минимум документа. Структурный тип: пакет не зависит от `lib.dom`. */
export interface GranumSheetDocument {
  readonly head: { appendChild: (node: never) => unknown }
  createElement: (tag: 'link') => unknown
  querySelector: (selector: string) => unknown
  /** Корень и окно — чтобы прочитать метку статически подключённого листа. */
  readonly documentElement?: unknown
  readonly defaultView?: { getComputedStyle?: (element: never) => { getPropertyValue: (name: string) => string } } | null
}

const pending = new WeakMap<object, Promise<void>>()

function defaultDocument(): GranumSheetDocument | undefined {
  return (globalThis as { document?: GranumSheetDocument }).document
}

/**
 * Атрибуты `<link>` листа дополнительной темы — для серверного `<head>`.
 * `undefined` — у темы своего листа нет: это основная тема.
 */
export function themeSheetLink(manifest: GranumThemeManifest, theme: string): Record<string, string> | undefined {
  const entry = findTheme(manifest, theme)
  if (!entry)
    throw new Error(`themeSheetLink: theme '${theme}' is not in the build. Themes: ${manifest.themes.map(t => t.id).join(', ')}.`)
  if (theme === manifest.defaultTheme)
    return undefined
  if (entry.href === undefined)
    throw new Error(`themeSheetLink: theme '${theme}' has no sheet address — the manifest was built before the bundle (resolveThemeManifest), use virtual:granum/themes.`)
  return { rel: 'stylesheet', href: entry.href, [THEME_SHEET_ATTRIBUTE]: theme }
}

/** Лист уже в документе без меченой ссылки — подключён статически (`virtual:granum/themes*.css`). */
function attached(doc: GranumSheetDocument, theme: string): boolean {
  if (doc.documentElement === undefined)
    return false
  try {
    return (doc.defaultView?.getComputedStyle?.(doc.documentElement as never)?.getPropertyValue(themeSheetMarker(theme)) ?? '').trim() !== ''
  }
  catch {
    return false
  }
}

function failure(theme: string, link: SheetLink): Error {
  return new Error(`granum: the sheet of theme '${theme}' failed to load (${link.href}).`)
}

/**
 * Дождаться ссылки, которая ещё грузится. Упавшая ссылка из документа уходит, а
 * отказ не запоминается: следующий вызов поставит новую и загрузит лист заново.
 */
function waitFor(link: SheetLink, theme: string): Promise<void> {
  const loaded = new Promise<void>((resolve, reject) => {
    link.addEventListener('load', () => {
      link.setAttribute(THEME_SHEET_STATE_ATTRIBUTE, 'load')
      resolve()
    }, { once: true })
    link.addEventListener('error', () => {
      link.setAttribute(THEME_SHEET_STATE_ATTRIBUTE, 'error')
      pending.delete(link)
      link.remove?.()
      reject(failure(theme, link))
    }, { once: true })
  })
  pending.set(link, loaded)
  return loaded
}

/**
 * Загрузить лист темы: вставить `<link>` в `<head>` и дождаться загрузки.
 * Повторный вызов и ссылка, уже вставленная скриптом или сервером, второй
 * ссылки не дают. Основная тема и среда без DOM — сразу: грузить нечего.
 */
export function loadThemeSheet(manifest: GranumThemeManifest, theme: string, options: { readonly document?: GranumSheetDocument } = {}): Promise<void> {
  const entry = findTheme(manifest, theme)
  if (!entry)
    return Promise.reject(new Error(`loadThemeSheet: theme '${theme}' is not in the build. Themes: ${manifest.themes.map(t => t.id).join(', ')}.`))
  if (theme === manifest.defaultTheme)
    return Promise.resolve()
  if (entry.href === undefined)
    return Promise.reject(new Error(`loadThemeSheet: theme '${theme}' has no sheet address — the manifest was built before the bundle (resolveThemeManifest), use virtual:granum/themes.`))
  const doc = options.document ?? defaultDocument()
  if (!doc)
    return Promise.resolve()

  const present = doc.querySelector(`link[${THEME_SHEET_ATTRIBUTE}="${theme}"]`) as SheetLink | null
  if (!present && attached(doc, theme))
    return Promise.resolve()
  if (present) {
    const known = pending.get(present)
    if (known)
      return known
    const state = present.getAttribute?.(THEME_SHEET_STATE_ATTRIBUTE)
    // Лист, загруженный до вызова, событие `load` уже не пришлёт.
    if (present.sheet || state === 'load')
      return Promise.resolve()
    if (state === 'error') {
      present.remove?.()
      return Promise.reject(failure(theme, present))
    }
    if (state === 'loading')
      return waitFor(present, theme)
    // Ни листа, ни отметки — ссылка сервера: грузится она или уже упала, по DOM
    // не различить. Вместо неё — своя, с отметкой; двух ссылок сразу нет.
    present.remove?.()
  }
  const link = doc.createElement('link') as SheetLink
  link.rel = 'stylesheet'
  link.href = entry.href
  link.setAttribute(THEME_SHEET_ATTRIBUTE, theme)
  link.setAttribute(THEME_SHEET_STATE_ATTRIBUTE, 'loading')
  const loaded = waitFor(link, theme)
  doc.head.appendChild(link as never)
  return loaded
}
