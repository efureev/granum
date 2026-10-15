/**
 * Хелперы извлечения классоподобных токенов (E-7) — для авторов движков.
 * Своей реализации движка ядро не содержит (INV-ENG-9), поэтому и здесь нет
 * ничего вендоренного: срезание комментариев и простая токенизация.
 *
 * `stripComments` — точная вещь и общая для всех словарей: движок сканирует
 * ТЕКСТ файла, и `<!-- p-4 -->` в шаблоне SFC давал бы утилиту, которой в
 * разметке нет (INV-ENG-5). Границы среза (E-12):
 *
 *   - JS/TS и всё, что не CSS и не разметка: блочные комментарии вне строк,
 *     шаблонных строк и регэксп-литералов; строчные — только когда строка
 *     состоит из одного комментария;
 *   - CSS: блочные вне строк и `url(…)`, строчные — так же, целой строкой;
 *   - разметка (`.vue`/`.html`/`.svelte`/`.astro`): HTML-комментарии,
 *     `{/* … *\/}` и строчные целой строкой (комментарии pug). Тела `<script>`
 *     и `<style>` (и frontmatter `.astro`) режутся по правилам JS и CSS.
 *     Голое `/*` в тексте разметки — проза (`accept="image/*"`), не комментарий;
 *   - вызовы `createCommentVNode("…")` скомпилированных шаблонов Vue.
 *
 * Строки разбираются, потому что `/*` внутри литерала (`'./icons/*.svg'`,
 * `Accept: '*\/*'`) съедал бы код до ближайшего закрывающего, и классы с
 * токенами пропадали бы молча (INV-DIAG-2). Разбор лексический, без парсера:
 * строки в кавычках обрываются на переводе строки, как в JS, поэтому апостроф
 * в тексте JSX ломает разбор не дальше своей строки. Регэксп от деления
 * отличается по предыдущему значимому токену — так, как это делают
 * подсветчики.
 *
 * `extractClasses` — токенизация по пробелам, кавычкам, точкам с запятой и
 * фигурным скобкам: имена классов эти символы содержать не могут, а всё
 * остальное (круглые и квадратные скобки, дефисы, двоеточия вариантов) —
 * может, и разрезать по ним нельзя, иначе `gap-[var(--x)]` распадётся.
 *
 * Токенизация НЕ понимает произвольные значения, внутри которых есть пробел
 * или кавычка (`grid-cols-[repeat(2, 1fr)]`, `content-['a b']`): словарю, где
 * такое возможно, нужен свой экстрактор — так и делает
 * `@feugene/granum-engine-wind`. Для словаря из простых имён этого хватает.
 *
 * Отбор кандидатов нарочно слабый: достаточно словарного символа. Лишнее
 * отбросит генератор, а слишком строгий фильтр молча потерял бы класс —
 * ошибка в эту сторону дороже (INV-DIAG-2).
 */

const HTML_LIKE = /\.(?:vue|html|htm|svelte|astro)$/i
const CSS_LIKE = /\.(?:css|scss|sass|less|pcss|postcss|styl)$/i
const ASTRO = /\.astro$/i

/** Frontmatter `.astro`: скрипт между двумя строками `---` в начале файла. */
const FRONTMATTER_RE = /^(\s*---[^\S\r\n]*\r?\n)([\s\S]*?)(?=\r?\n---)/

/** Разделители токенов; ведущий обратный слеш или двоеточие съедается вместе с ними. */
const SPLIT_RE = /[\\:]?[\s"'`;{}]+/

/** Кандидат содержит хотя бы один символ имени: буква любого письма, цифра, подчёркивание, `%`, `?` или `-`. */
const CLASS_LIKE_RE = /[\p{L}\p{N}_%?-]/u

/** После этих слов `/` начинает регэксп, а не делит. */
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])

/**
 * Какие строчные комментарии вырезать: `whole-line` — только строку, в которой
 * кроме комментария ничего нет (извлечению классов: `//` в тексте JSX — часть
 * URL, а не комментарий); `all` — любые вне строк (поиску импортов).
 */
export type LineComments = 'whole-line' | 'all'

export function stripComments(code: string, id: string): string {
  return stripCommentsWith(code, id, 'whole-line')
}

/** `stripComments` с выбором режима строчных комментариев; наружу из `./engine` не уходит. */
export function stripCommentsWith(code: string, id: string, lineComments: LineComments): string {
  const out = HTML_LIKE.test(id)
    ? stripMarkup(code, id, lineComments)
    : CSS_LIKE.test(id) ? stripCss(code) : stripScript(code, lineComments)
  // Скомпилированный шаблон Vue хранит HTML-комментарий вызовом
  // `createCommentVNode("…")` — это тот же комментарий SFC, только в JS.
  return out.replace(/\b_?createCommentVNode\(\s*(["'])(?:(?!\1)[\s\S])*?\1/g, 'createCommentVNode(""')
}

export function extractClasses(code: string, id: string): Set<string> {
  const set = new Set<string>()
  for (const token of stripComments(code, id).split(SPLIT_RE)) {
    if (token.length > 0 && CLASS_LIKE_RE.test(token))
      set.add(token)
  }
  return set
}

/** Вырезка диапазонов срезами: чанки бывают мегабайтными, посимвольная склейка дорога. */
interface Cuts {
  cut: (start: number, end: number, replacement: string) => void
  done: () => string
}

function cuts(code: string): Cuts {
  const parts: string[] = []
  let last = 0
  return {
    cut(start, end, replacement) {
      parts.push(code.slice(last, start), replacement)
      last = end
    },
    done() {
      parts.push(code.slice(last))
      return parts.join('')
    },
  }
}

function isWordChar(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36 || c > 127
}

/** Позиция сразу за закрывающим `*` + `/` блочного комментария, открытого до `from`; `-1`, если его нет. */
function blockCommentEnd(code: string, from: number): number {
  for (let j = from; j < code.length - 1; j++) {
    if (code[j] === '*' && code[j + 1] === '/')
      return j + 2
  }
  return -1
}

function lineEnd(code: string, from: number): number {
  const eol = code.indexOf('\n', from)
  return eol < 0 ? code.length : eol
}

/** Строка в кавычках с `from`: позиция за закрывающей кавычкой или на переводе строки. */
function skipQuoted(code: string, from: number): number {
  const quote = code[from]
  let j = from + 1
  while (j < code.length) {
    const ch = code[j]
    if (ch === '\\')
      j += 2
    else if (ch === quote)
      return j + 1
    else if (ch === '\n')
      return j
    else
      j++
  }
  return code.length
}

/** Тело шаблонной строки с `from`: позиция за `` ` `` либо за `${` (тогда `expr`). */
function skipTemplate(code: string, from: number): { end: number, expr: boolean } {
  let j = from
  while (j < code.length) {
    const ch = code[j]
    if (ch === '\\')
      j += 2
    else if (ch === '`')
      return { end: j + 1, expr: false }
    else if (ch === '$' && code[j + 1] === '{')
      return { end: j + 2, expr: true }
    else
      j++
  }
  return { end: code.length, expr: false }
}

/** Регэксп-литерал с `from` (на `/`): позиция за флагами; `-1`, если до конца строки он не закрылся. */
function skipRegex(code: string, from: number): number {
  let j = from + 1
  let inClass = false
  while (j < code.length) {
    const ch = code[j]
    if (ch === '\n')
      return -1
    if (ch === '\\') {
      j += 2
      continue
    }
    if (inClass) {
      if (ch === ']')
        inClass = false
    }
    else if (ch === '[') {
      inClass = true
    }
    else if (ch === '/') {
      j++
      while (j < code.length && isWordChar(code.charCodeAt(j)))
        j++
      return j
    }
    j++
  }
  return -1
}

/** Что видит обход JS-кода: всё вне строк, шаблонов, регэкспов и комментариев — кодом. */
export interface ScriptScanVisitor {
  /** Комментарий `[start, end)`; `lineHasCode` — до него на той же строке был код. */
  readonly comment?: (start: number, end: number, kind: 'block' | 'line', lineHasCode: boolean) => void
  /** Слово кода: идентификатор или ключевое слово. */
  readonly word?: (start: number, end: number) => void
  /** Строка в кавычках вместе с кавычками; обрывается на переводе строки, если не закрыта. */
  readonly string?: (start: number, end: number) => void
  /** Прочий символ кода: скобка, точка, оператор. */
  readonly punct?: (at: number) => void
}

/**
 * Обход JS/TS-кода по лексемам. Строки, тела шаблонов и регэксп-литералы
 * пропускаются целиком, подстановки `${…}` — код. Незакрытый блочный
 * комментарий останавливает обход: его конец неизвестен.
 */
export function scanScript(code: string, visitor: ScriptScanVisitor): void {
  /** Глубина `{` в каждом открытом `${…}` шаблонной строки. */
  const templates: number[] = []
  let regexOk = true
  let lineHasCode = false
  let i = 0
  const template = (from: number): void => {
    const { end, expr } = skipTemplate(code, from)
    if (expr)
      templates.push(0)
    regexOk = expr
    i = end
  }

  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (ch === '\n') {
      lineHasCode = false
      i++
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      const end = blockCommentEnd(code, i + 2)
      if (end < 0)
        return
      visitor.comment?.(i, end, 'block', lineHasCode)
      i = end
      continue
    }
    if (ch === '/' && next === '/') {
      // Комментарий пропускается целиком: апостроф в нём не открывает строку.
      const eol = lineEnd(code, i)
      visitor.comment?.(i, eol, 'line', lineHasCode)
      i = eol
      continue
    }

    lineHasCode = true
    if (ch === '\'' || ch === '"') {
      const start = i
      i = skipQuoted(code, i)
      visitor.string?.(start, i)
      regexOk = false
    }
    else if (ch === '`') {
      template(i + 1)
    }
    else if (ch === '/') {
      const end: number = regexOk ? skipRegex(code, i) : -1
      if (end < 0)
        visitor.punct?.(i)
      i = end > 0 ? end : i + 1
      regexOk = end < 0
    }
    else if (ch === '{') {
      const top = templates.length - 1
      if (top >= 0)
        templates[top] = templates[top]! + 1
      visitor.punct?.(i)
      i++
      regexOk = true
    }
    else if (ch === '}') {
      const top = templates.length - 1
      if (top >= 0 && templates[top] === 0) {
        templates.pop()
        template(i + 1)
        continue
      }
      if (top >= 0)
        templates[top] = templates[top]! - 1
      visitor.punct?.(i)
      i++
      regexOk = true
    }
    else if (isWordChar(code.charCodeAt(i))) {
      const start = i
      while (i < code.length && isWordChar(code.charCodeAt(i)))
        i++
      visitor.word?.(start, i)
      regexOk = REGEX_AFTER_WORD.has(code.slice(start, i))
    }
    else {
      visitor.punct?.(i)
      regexOk = ch !== ')' && ch !== ']'
      i++
    }
  }
}

function stripScript(code: string, lineComments: LineComments): string {
  const out = cuts(code)
  scanScript(code, {
    comment(start, end, kind, lineHasCode) {
      if (kind === 'block')
        out.cut(start, end, ' ')
      else if (lineComments === 'all' || !lineHasCode)
        out.cut(start, end, '')
    },
  })
  return out.done()
}

interface CssStripOptions {
  /** Строчный `//` целой строкой: в исходниках с синтаксисом препроцессора он бывает, в CSS — нет. */
  readonly lineComments: boolean
  /** Чем заменить комментарий `/* … *\/` длиной `length`. */
  readonly replace: (length: number) => string
}

const SOURCE_CSS: CssStripOptions = { lineComments: true, replace: () => ' ' }

/** Чем заменить комментарий: убрать, пробелом или пробелами той же длины (когда важны смещения). */
export type CssCommentReplacement = 'remove' | 'space' | 'keep-offsets'

/**
 * Комментарии `/* *\/` CSS — с учётом строк и нецитированного `url(…)`: `/*`
 * внутри них комментарий не открывает. Регэксп по всему тексту съел бы CSS до
 * ближайшего `*\/`, и правила за ним пропали бы молча. `//` в CSS не
 * комментарий и не трогается; незакрытый `/*` ничего не съедает.
 */
export function stripCssComments(css: string, replacement: CssCommentReplacement = 'remove'): string {
  const replace = replacement === 'remove'
    ? () => ''
    : replacement === 'space' ? () => ' ' : (length: number) => ' '.repeat(length)
  return stripCss(css, { lineComments: false, replace })
}

function stripCss(code: string, options: CssStripOptions = SOURCE_CSS): string {
  const out = cuts(code)
  let lineHasCode = false
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (ch === '\n') {
      lineHasCode = false
      i++
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      const end = blockCommentEnd(code, i + 2)
      if (end < 0)
        break
      out.cut(i, end, options.replace(end - i))
      i = end
      continue
    }
    if (ch === '/' && next === '/' && !lineHasCode && options.lineComments) {
      const eol = lineEnd(code, i)
      out.cut(i, eol, '')
      i = eol
      continue
    }

    lineHasCode = true
    if (ch === '\'' || ch === '"') {
      i = skipQuoted(code, i)
    }
    else if ((ch === 'u' || ch === 'U') && code.slice(i, i + 4).toLowerCase() === 'url(' && (i === 0 || !isCssNameChar(code.charCodeAt(i - 1)))) {
      // Нецитированный `url(…)` — один токен: `/*` внутри него не комментарий.
      let j = i + 4
      while (code[j] === ' ' || code[j] === '\t' || code[j] === '\n' || code[j] === '\r')
        j++
      if (code[j] === '\'' || code[j] === '"') {
        i = j
      }
      else {
        const close = code.indexOf(')', j)
        i = close < 0 ? code.length : close + 1
      }
    }
    else {
      i++
    }
  }
  return out.done()
}

function isCssNameChar(c: number): boolean {
  return isWordChar(c) || c === 45
}

/** Разметка вне `<script>`/`<style>`: в ней нет блочных комментариев, кроме выражения `{/* … *\/}`. */
function stripMarkupText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '{}')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
}

function stripMarkup(code: string, id: string, lineComments: LineComments): string {
  const parts: string[] = []
  let segment = 0

  const frontmatter = ASTRO.test(id) ? FRONTMATTER_RE.exec(code) : null
  if (frontmatter) {
    const head = frontmatter[1]!
    const body = frontmatter[2]!
    parts.push(head, stripScript(body, lineComments))
    segment = head.length + body.length
  }

  // `<script>` внутри HTML-комментария регионом не считается: комментарий перешагивается целиком.
  const tags = /<!--|<(script|style)(?=[\s/>])/gi
  tags.lastIndex = segment
  for (let m = tags.exec(code); m !== null; m = tags.exec(code)) {
    if (m[1] === undefined) {
      const end = code.indexOf('-->', m.index + 4)
      if (end < 0)
        break
      tags.lastIndex = end + 3
      continue
    }
    const open = code.indexOf('>', tags.lastIndex)
    if (open < 0)
      break
    const isScript = m[1].toLowerCase() === 'script'
    const closing = isScript ? /<\/script/gi : /<\/style/gi
    closing.lastIndex = open + 1
    const close = closing.exec(code)
    const bodyEnd = close ? close.index : code.length
    const body = code.slice(open + 1, bodyEnd)
    parts.push(stripMarkupText(code.slice(segment, open + 1)), isScript ? stripScript(body, lineComments) : stripCss(body))
    segment = bodyEnd
    tags.lastIndex = bodyEnd
  }
  parts.push(stripMarkupText(code.slice(segment)))
  return parts.join('')
}
