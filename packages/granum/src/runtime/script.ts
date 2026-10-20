/**
 * Режим до первого кадра и cookie для SSR. Чистые функции:
 * строку скрипта вставляет приложение или плагин, cookie читает сервер.
 */
import type { GranumThemeStorage } from './controller'
import type { GranumModeEntry, GranumThemeManifest } from './manifest'
import { DEFAULT_THEME_STORAGE_KEY } from './controller'

export interface GranumThemeScriptCodeOptions {
  readonly manifest: GranumThemeManifest
  /** Ключ `localStorage`. По умолчанию `granum-theme` — тот же, что у контроллера. */
  readonly storageKey?: string
  /** Имя cookie, если режим хранится в ней (`createCookieStorage`): cookie читается раньше `localStorage`. */
  readonly cookie?: string
  /**
   * События `document`, после которых пара ставится заново. Хост, который
   * подменяет документ без перезагрузки, копирует атрибуты корня из нового
   * документа, а там пары нет: `astro:after-swap` у `ClientRouter` Astro,
   * `turbo:load` у Turbo.
   */
  readonly reapplyOn?: readonly string[]
}

export interface GranumThemeScriptOptions extends GranumThemeScriptCodeOptions {
  /** `nonce` для Content-Security-Policy. */
  readonly nonce?: string
}

/** Имя cookie — токен RFC 6265: в нём нет ни `;`, ни `=`, ни символов, ломающих `<script>`. */
const COOKIE_NAME_RE = /^[!#$%&'*+\-.^\w`|~]+$/
/**
 * Ключ объекта, который можно написать без кавычек. Это правило синтаксиса JS,
 * а не правило имени режима: если имена режимов когда-нибудь расширят, ключ
 * просто уйдёт в кавычки, а скрипт в `<head>` останется валидным.
 */
const IDENTIFIER_RE = /^[a-z][a-z0-9]*$/

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Строковый литерал JS, который не закроет `<script>`. */
function literal(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** Пара режима, который выбрала бы системная схема: первый режим этой схемы, иначе режим по умолчанию. */
function systemPair(manifest: GranumThemeManifest, scheme: 'light' | 'dark'): string {
  const mode = manifest.modes.find(m => m.colorScheme === scheme)
    ?? manifest.modes.find(m => m.name === manifest.defaultMode)
    ?? manifest.modes[0]!
  return mode.value
}

/**
 * Код скрипта, ставящего пару на корень до первого кадра, без тега `<script>` —
 * для хоста, который вставляет его сам (`injectScript` Astro).
 *
 * Правило — то же, что у контроллера с `initial: 'auto'`: пара,
 * уже стоящая на корне, остаётся; иначе режим из cookie, из `localStorage`,
 * первый режим системной схемы, режим по умолчанию. Код собирается под
 * манифест: пары и выбор по схеме — константами, ветка cookie — только при
 * `cookie`. Исключение из скрипта не выходит: в `<head>` оно оставило бы
 * страницу без пары и без ошибки, которую кто-то увидит.
 */
export function createThemeScriptCode(options: GranumThemeScriptCodeOptions): string {
  const { manifest } = options
  if (manifest.modes.length === 0)
    throw new Error('createThemeScript: the manifest has no modes — the build contains no theme.')
  if (options.cookie !== undefined && !COOKIE_NAME_RE.test(options.cookie))
    throw new Error(`createThemeScript: cookie name '${options.cookie}' is not a valid cookie token.`)

  const pairs = manifest.modes.map(m => `${IDENTIFIER_RE.test(m.name) ? m.name : literal(m.name)}:${literal(m.value)}`).join(',')
  const dark = systemPair(manifest, 'dark')
  const light = systemPair(manifest, 'light')
  const system = dark === light
    ? literal(dark)
    : `window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?${literal(dark)}:${literal(light)}`
  // Имя режима — идентификатор, а такой `encodeURIComponent` не меняет:
  // cookie сравнивается с именами как есть, без разбора кодирования.
  // `document.cookie` браузер отдаёт через `; ` — другого разделителя там нет.
  const cookie = options.cookie !== undefined
    ? `try{c=(d.cookie.match(/(?:^|; )${options.cookie.replace(/[$*+.^|]/g, '\\$&')}=([^;]*)/)||0)[1]}catch(e){}`
    : ''
  const listen = (options.reapplyOn ?? []).map(event => `d.addEventListener(${literal(event)},f);`).join('')
  const vars = options.cookie !== undefined ? 's,c,p,q,k' : 's,p,k'
  const pick = options.cookie !== undefined ? 'if(k===c)q=m[k];if(k===s)p=m[k]' : 'if(k===s)p=m[k]'
  const chosen = options.cookie !== undefined ? 'q||p' : 'p'

  // Именованная функция: `addEventListener` с той же функцией не дублирует
  // подписку, поэтому повторный вызов по событию её не умножает.
  // `document` в переменной окупается только со второго обращения.
  const root = cookie || listen ? 'd=document,r=d.documentElement' : 'r=document.documentElement'

  return `(function f(){try{var ${root},a=${literal(manifest.activation.attribute)},`
    + `m={${pairs}},v=r.getAttribute(a),${vars};${listen}${cookie}`
    + `try{s=localStorage.getItem(${literal(options.storageKey ?? DEFAULT_THEME_STORAGE_KEY)})}catch(e){}`
    + `for(k in m){if(m[k]===v)return;${pick}}`
    + `r.setAttribute(a,${chosen}||(${system}))}catch(e){}})()`
}

/**
 * Строка `<script>` для `<head>`: ставит пару на корень до первого кадра
 * (`createThemeScriptCode`).
 */
export function createThemeScript(options: GranumThemeScriptOptions): string {
  const nonce = options.nonce !== undefined ? ` nonce="${escapeAttribute(options.nonce)}"` : ''
  return `<script${nonce}>${createThemeScriptCode(options)}</script>`
}

export interface GranumCookieStorageOptions {
  /** Имя cookie. По умолчанию `granum-theme`. */
  readonly name?: string
  /** Срок жизни в секундах. По умолчанию год. */
  readonly maxAge?: number
  readonly path?: string
  readonly sameSite?: 'lax' | 'strict' | 'none'
  /**
   * Атрибут `Secure`. По умолчанию — только при `sameSite: 'none'`: без него
   * браузер такую cookie отклоняет, и выбор режима молча не сохраняется.
   */
  readonly secure?: boolean
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
 * Хранилище режима в cookie: сервер читает его из заголовка запроса и
 * сразу отдаёт `<html data-theme="<пара>">` — скрипт до первого кадра тогда не нужен.
 */
export function createCookieStorage(options: GranumCookieStorageOptions = {}): GranumThemeStorage {
  const name = options.name ?? DEFAULT_THEME_STORAGE_KEY
  const sameSite = options.sameSite ?? 'lax'
  const secure = options.secure ?? sameSite === 'none'
  if (sameSite === 'none' && !secure)
    throw new TypeError(`createCookieStorage: SameSite=None requires Secure — browsers reject such a cookie, and the chosen mode would never persist`)
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
      target.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${options.maxAge ?? 31536000}; Path=${options.path ?? '/'}; SameSite=${sameSite}${secure ? '; Secure' : ''}`
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
