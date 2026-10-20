/**
 * Выбор темы и режима до первого кадра и cookie для SSR. Чистые функции:
 * строку скрипта вставляет приложение или плагин, cookie читает сервер.
 */
import type { GranumThemeStorage } from './controller'
import type { GranumThemeManifest, GranumThemeSelection, GranumThemeSelectionInput } from './manifest'
import { DEFAULT_THEME_STORAGE_KEY } from './controller'
import { defaultTheme, findTheme, isSelectableTheme, readThemeSelection, themeSelectionKey } from './manifest'
import { THEME_SHEET_ATTRIBUTE, THEME_SHEET_STATE_ATTRIBUTE } from './sheets'

export interface GranumThemeScriptCodeOptions {
  readonly manifest: GranumThemeManifest
  /** Ключ `localStorage`. По умолчанию `granum-theme` — тот же, что у контроллера. */
  readonly storageKey?: string
  /** Имя cookie, если выбор хранится в ней (`createCookieStorage`): cookie читается раньше `localStorage`. */
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
 * а не правило имени режима: ключ дополнительной темы с дефисом просто уходит
 * в кавычки, а скрипт в `<head>` остаётся валидным.
 */
const IDENTIFIER_RE = /^[a-z][a-z0-9]*$/

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Строковый литерал JS, который не закроет `<script>`. */
function literal(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function key(name: string): string {
  return IDENTIFIER_RE.test(name) ? name : literal(name)
}

/** Пара режима, который выбрала бы системная схема: первый режим основной темы этой схемы, иначе режим по умолчанию. */
function systemPair(manifest: GranumThemeManifest, scheme: 'light' | 'dark'): string {
  const main = defaultTheme(manifest)
  const mode = main.modes.find(m => m.colorScheme === scheme)
    ?? main.modes.find(m => m.name === main.defaultMode)
    ?? main.modes[0]!
  return mode.value
}

/**
 * Код скрипта, ставящего пару на корень до первого кадра, без тега `<script>` —
 * для хоста, который вставляет его сам (`injectScript` Astro).
 *
 * Правило — то же, что у контроллера с `initial: 'auto'`: пара, уже стоящая на
 * корне, остаётся; иначе выбор из cookie, из `localStorage`, первый режим
 * системной схемы основной темы, её режим по умолчанию. Для дополнительной
 * темы скрипт сначала вставляет `<link>` её листа с `blocking="render"`, и
 * только потом ставит пару; тема без адреса листа в выбор не попадает вовсе —
 * её пара без листа дала бы значения основной темы под чужим именем.
 *
 * Код собирается под манифест: ключи, пары, адреса и выбор по схеме —
 * константами, ветки cookie, листов и `reapplyOn` — только когда нужны.
 * Исключение из скрипта не выходит: в `<head>` оно оставило бы страницу без
 * пары и без ошибки, которую кто-то увидит.
 */
export function createThemeScriptCode(options: GranumThemeScriptCodeOptions): string {
  const { manifest } = options
  const main = manifest ? findTheme(manifest) : undefined
  if (!main || main.modes.length === 0)
    throw new Error('createThemeScript: the manifest has no modes — the build contains no theme.')
  if (options.cookie !== undefined && !COOKIE_NAME_RE.test(options.cookie))
    throw new Error(`createThemeScript: cookie name '${options.cookie}' is not a valid cookie token.`)

  // Ключ выбора → пара. Темы без адреса листа в карту не входят.
  const selectable = manifest.themes.filter(theme => isSelectableTheme(manifest, theme))
  const pairs = selectable
    .flatMap(theme => theme.modes.map(mode => `${key(themeSelectionKey(manifest, theme.id, mode.name))}:${literal(mode.value)}`))
    .join(',')
  // Тема → адрес листа: по ключу выбора дополнительной темы, у основной ключа без дефиса нет.
  const sheets = selectable.filter(theme => theme.id !== manifest.defaultTheme)
  const hrefs = sheets.map(theme => `${key(theme.id)}:${literal(theme.href!)}`).join(',')
  const dark = systemPair(manifest, 'dark')
  const light = systemPair(manifest, 'light')
  const system = dark === light
    ? literal(dark)
    : `window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?${literal(dark)}:${literal(light)}`
  // Ключ выбора — имена из `[a-z0-9-]`, а такие `encodeURIComponent` не меняет:
  // cookie сравнивается с ключами как есть, без разбора кодирования.
  // `document.cookie` браузер отдаёт через `; ` — другого разделителя там нет.
  const cookie = options.cookie !== undefined
    ? `try{c=(d.cookie.match(/(?:^|; )${options.cookie.replace(/[$*+.^|]/g, '\\$&')}=([^;]*)/)||0)[1]}catch(e){}`
    : ''
  const listen = (options.reapplyOn ?? []).map(event => `d.addEventListener(${literal(event)},f);`).join('')
  const vars = options.cookie !== undefined ? 's,c,p,q,k' : 's,p,k'
  // Без листов достаточно пары; с ними нужен ключ — по нему ищется тема.
  const value = sheets.length > 0 ? 'k' : 'm[k]'
  const pick = options.cookie !== undefined ? `if(k===c)q=${value};if(k===s)p=${value}` : `if(k===s)p=${value}`
  const chosen = options.cookie !== undefined ? 'q||p' : 'p'
  // Лист дополнительной темы — до пары: `blocking="render"` держит первый кадр,
  // пока лист не загрузится. Ссылку, уже вставленную сервером, второй не дублируем.
  // Состояние ссылки отмечается: контроллер придёт позже, и событие, случившееся
  // до него, иначе не узнал бы — упавший лист ждал бы вечно. `this`, а не `l`:
  // повторный вызов по `reapplyOn` переназначит переменную.
  const state = literal(THEME_SHEET_STATE_ATTRIBUTE)
  const link = sheets.length > 0
    ? `t=k&&(/(.*)-/.exec(k)||0)[1],u=t&&h[t];if(u&&!d.querySelector('link[${THEME_SHEET_ATTRIBUTE}="'+t+'"]')){l=d.createElement("link");l.rel="stylesheet";l.href=u;l.setAttribute("blocking","render");l.setAttribute(${literal(THEME_SHEET_ATTRIBUTE)},t);l.setAttribute(${state},"loading");l.onload=l.onerror=function(e){this.setAttribute(${state},e.type)};d.head.appendChild(l)}`
    : ''
  const hasDocument = cookie || listen || link
  // Именованная функция: `addEventListener` с той же функцией не дублирует
  // подписку, поэтому повторный вызов по событию её не умножает.
  // `document` в переменной окупается только со второго обращения.
  const root = hasDocument ? 'd=document,r=d.documentElement' : 'r=document.documentElement'
  const extra = link ? `,h={${hrefs}},t,u,l` : ''
  const apply = link
    ? `k=${chosen};${link}r.setAttribute(a,k?m[k]:${system})`
    : `r.setAttribute(a,${chosen}||(${system}))`
  return `(function f(){try{var ${root},a=${literal(manifest.activation.attribute)},`
    + `m={${pairs}}${extra},v=r.getAttribute(a),${vars};${listen}${cookie}`
    + `try{s=localStorage.getItem(${literal(options.storageKey ?? DEFAULT_THEME_STORAGE_KEY)})}catch(e){}`
    + `for(k in m){if(m[k]===v)return;${pick}}`
    + `${apply}}catch(e){}})()`
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
   * браузер такую cookie отклоняет, и выбор молча не сохраняется.
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
 * Хранилище выбора в cookie: сервер читает его из заголовка запроса и
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
 * Тема и режим по заголовку `Cookie` запроса — для серверного рендера, тем же
 * правилом, что у хранилища контроллера. Неизвестное значение и отсутствие
 * cookie дают `undefined`: решать за пользователя по системной схеме сервер не
 * может, это сделает скрипт.
 */
export function themeFromCookie(manifest: GranumThemeManifest, cookieHeader: string | null | undefined, name: string = DEFAULT_THEME_STORAGE_KEY): GranumThemeSelection | undefined {
  if (!cookieHeader)
    return undefined
  return readThemeSelection(manifest, readCookie(cookieHeader, name))
}

/** Атрибуты корня для выбора: `{ 'data-theme': 'slate-dark' }`. По умолчанию — основная тема и её режим по умолчанию. */
export function themeRootAttributes(manifest: GranumThemeManifest, selection: GranumThemeSelectionInput = {}): Record<string, string> {
  const theme = findTheme(manifest, selection.theme)
  if (!theme)
    throw new Error(`themeRootAttributes: theme '${selection.theme}' is not in the build. Themes: ${manifest.themes.map(t => t.id).join(', ')}.`)
  const name = selection.mode ?? theme.defaultMode
  const entry = theme.modes.find(m => m.name === name)
  if (!entry)
    throw new Error(`themeRootAttributes: mode '${name}' is not in the build of theme '${theme.id}'. Available: ${theme.modes.map(m => m.name).join(', ')}.`)
  return { [manifest.activation.attribute]: entry.value }
}
