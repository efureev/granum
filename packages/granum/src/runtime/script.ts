/**
 * Режим до первого кадра (RT-3) и cookie для SSR (RT-4). Чистые функции:
 * строку скрипта вставляет приложение или плагин, cookie читает сервер.
 */
import type { GranumThemeStorage } from './controller'
import type { GranumModeEntry, GranumThemeManifest } from './manifest'
import { DEFAULT_THEME_STORAGE_KEY } from './controller'

export interface GranumThemeScriptOptions {
  readonly manifest: GranumThemeManifest
  /** Ключ `localStorage`. По умолчанию `granum-theme` — тот же, что у контроллера. */
  readonly storageKey?: string
  /** `nonce` для Content-Security-Policy. */
  readonly nonce?: string
  /** Имя cookie, если режим хранится в ней (`createCookieStorage`): cookie читается раньше `localStorage`. */
  readonly cookie?: string
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * Строка `<script>` для `<head>`: ставит пару на корень до первого кадра —
 * сохранённый режим, иначе по системной схеме, иначе режим по умолчанию. Пара,
 * уже выставленная сервером, не трогается.
 */
export function createThemeScript(options: GranumThemeScriptOptions): string {
  const { manifest } = options
  const data = {
    a: manifest.activation.attribute,
    k: options.storageKey ?? DEFAULT_THEME_STORAGE_KEY,
    c: options.cookie ?? null,
    d: manifest.defaultMode,
    m: Object.fromEntries(manifest.modes.map(mode => [mode.name, [mode.value, mode.colorScheme]])),
  }
  // `<` экранируется: значение внутри `<script>` не должно закрыть тег.
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const body = `(function(){var o=${json},r=document.documentElement,v=r.getAttribute(o.a),s=null,n,i;`
    + `for(n in o.m)if(o.m[n][0]===v)return;`
    + `if(o.c){var p=document.cookie.split(';');for(i=0;i<p.length;i++){var e=p[i].indexOf('=');if(p[i].slice(0,e).trim()===o.c){try{s=decodeURIComponent(p[i].slice(e+1).trim())}catch(x){}}}}`
    + `if(!s||!o.m[s]){try{s=localStorage.getItem(o.k)}catch(x){}}`
    + `if(!s||!o.m[s]){var d=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';s=o.d;for(n in o.m)if(o.m[n][1]===d){s=n;break}}`
    + `r.setAttribute(o.a,o.m[s][0])})()`
  const nonce = options.nonce !== undefined ? ` nonce="${escapeAttribute(options.nonce)}"` : ''
  return `<script${nonce}>${body}</script>`
}

export interface GranumCookieStorageOptions {
  /** Имя cookie. По умолчанию `granum-theme`. */
  readonly name?: string
  /** Срок жизни в секундах. По умолчанию год. */
  readonly maxAge?: number
  readonly path?: string
  readonly sameSite?: 'lax' | 'strict' | 'none'
  /** Доступ к `document.cookie`; по умолчанию глобальный `document`. */
  readonly document?: { cookie: string }
}

function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim())
      }
      catch {
        return undefined
      }
    }
  }
  return undefined
}

/**
 * Хранилище режима в cookie (RT-4): сервер читает его из заголовка запроса и
 * сразу отдаёт `<html data-theme="<пара>">` — скрипт до первого кадра тогда не нужен.
 */
export function createCookieStorage(options: GranumCookieStorageOptions = {}): GranumThemeStorage {
  const name = options.name ?? DEFAULT_THEME_STORAGE_KEY
  const doc = (): { cookie: string } | undefined => options.document ?? (globalThis as { document?: { cookie: string } }).document
  return {
    getItem: () => {
      const cookie = doc()?.cookie
      return cookie === undefined ? null : readCookie(cookie, name) ?? null
    },
    setItem: (_key, value) => {
      const target = doc()
      if (!target)
        return
      target.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${options.maxAge ?? 31536000}; Path=${options.path ?? '/'}; SameSite=${options.sameSite ?? 'lax'}`
    },
  }
}

/**
 * Режим по заголовку `Cookie` запроса — для серверного рендера. Неизвестное
 * значение и отсутствие cookie дают `undefined`: решать за пользователя по
 * системной схеме сервер не может, это сделает скрипт.
 */
export function modeFromCookie(manifest: GranumThemeManifest, cookieHeader: string | null | undefined, name: string = DEFAULT_THEME_STORAGE_KEY): GranumModeEntry | undefined {
  if (!cookieHeader)
    return undefined
  const value = readCookie(cookieHeader, name)
  return manifest.modes.find(mode => mode.name === value)
}

/** Атрибуты корня для режима: `{ 'data-theme': 'slate-dark' }`. */
export function themeRootAttributes(manifest: GranumThemeManifest, mode: string = manifest.defaultMode): Record<string, string> {
  const entry = manifest.modes.find(m => m.name === mode)
  if (!entry)
    throw new Error(`themeRootAttributes: mode '${mode}' is not in the build. Available: ${manifest.modes.map(m => m.name).join(', ')}.`)
  return { [manifest.activation.attribute]: entry.value }
}
