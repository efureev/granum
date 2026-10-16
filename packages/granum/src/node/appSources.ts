/**
 * Скан исходников приложения: классы для движка, потребление
 * токенов, импорты компонентов провайдеров. Директории, не globs: обход
 * рекурсивный, расширения — параметр.
 */
import type { GranumAppSources } from '../config'
import type { GranumEngine } from '../engine/types'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { sortedUnique } from '../core/dedupe'
import { scanScript, stripComments } from '../engine/extract'
import { declaredCssClasses } from './diagnostics/auditDist'
import { scanTokenConsumption } from './tokenScan'

export const DEFAULT_APP_EXTENSIONS = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'vue', 'svelte', 'astro', 'html', 'css'] as const

export interface AppSourcesScan {
  readonly files: readonly string[]
  readonly classes: readonly string[]
  /** Потребляемые токены, с `--`. */
  readonly consumes: readonly string[]
  /** Импорты вида `<pkg>/components/<Name>`: ключи `pkg:Name`. */
  readonly componentImports: readonly string[]
  /** PascalCase-теги разметки (`<XhPanel>`): кандидаты в селекцию при auto-import. */
  readonly componentTags: readonly string[]
  /** Классы из атрибутов разметки → файлы, где они стоят: их отчёт судит, в отличие от прочих слов. */
  readonly classAttributes: Readonly<Record<string, readonly string[]>>
  /**
   * Классы, объявленные `.css`-файлами: правило у приложения есть, даже если лист
   * приходит строкой (`?raw`, `?inline`), а не ассетом бандла. CSS-модули
   * (`*.module.css`) не в счёт: их классы хешируются, и литерал в разметке с
   * ними не совпадёт.
   */
  readonly declaredClasses: readonly string[]
}

/**
 * Кандидат в импорт компонента: `'<pkg>/components/<Name>'`. Имя — по правилу имён
 * компонентов, со строчной буквы тоже. Под шаблон попадают и чужие пути (`~/components/…`,
 * `vuetify/components/…`) — их отсекает сверка с графом в `importSelection`.
 */
const COMPONENT_IMPORT_RE = /["'](@[^/"']+\/[^/"']+|[^./@"'][^/"']*)\/components\/([A-Za-z][\w-]*)["']/g

export function listSourceFiles(dir: string, extensions: readonly string[]): string[] {
  const allowed = new Set(extensions.map(e => `.${e}`))
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && allowed.has(extname(entry.name)) && !entry.parentPath.split(/[\\/]/).includes('node_modules'))
      .map(entry => join(entry.parentPath, entry.name))
      .sort()
  }
  catch {
    return []
  }
}

/** Открывающий тег с именем в PascalCase; kebab-case не считается: авто-импорт по нему всё равно ведёт к тому же имени через резолвер. */
const COMPONENT_TAG_RE = /<([A-Z]\w*)(?=[\s/>])/g

/**
 * Статический `class="…"` или `className="…"`: перед именем — не `:`, `@`, `.`, `-`,
 * не буква и не `[` — `[class="x"]` это селектор CSS, а не атрибут.
 */
const STATIC_CLASS_RE = /(?<![\w:@.[-])(?:class|className)\s*=\s*(["'])([\s\S]*?)\1/g
/** JSX: `className={'…'}`, `className={"…"}`, `` className={`…`} ``. */
const JSX_CLASS_RE = /(?<![\w:@.-])className\s*=\s*\{\s*(["'`])([\s\S]*?)\1\s*\}/g
/** Vue: `:class="…"` и `v-bind:class="…"` — выражение, а не список классов. */
const VUE_CLASS_RE = /(?<![\w@.-])(?::|v-bind:)class\s*=\s*(["'])([\s\S]*?)\1/g

/** JS/TS без JSX: разметка в нём бывает только внутри литералов. */
const SCRIPT_FILE_RE = /\.[cm]?[jt]s$/i
/** Разметка, в которой код живёт блоками `<script>` и frontmatter Astro. */
const MARKUP_FILE_RE = /\.(?:vue|svelte|astro|html?)$/i
const SCRIPT_BLOCK_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const FRONTMATTER_RE = /^\s*---\r?\n([\s\S]*?)\r?\n---/

/**
 * Тело `<script>` — JS без JSX: тип не задан или JS-овый, язык не `jsx`/`tsx`.
 * Шаблон (`type="text/x-template"`), JSON и JSX остаются разметкой.
 */
function isScriptBlock(attrs: string): boolean {
  const type = /(?<![\w:-])type\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]
  const lang = /(?<![\w:-])lang\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]
  return (type === undefined || /^(?:module|(?:text|application)\/(?:java|ecma|type)script)$/i.test(type))
    && (lang === undefined || !/^[jt]sx$/i.test(lang))
}

type AddValue = (value: string) => void

/** Атрибуты класса в тексте разметки. */
function collectFromMarkup(text: string, add: AddValue): void {
  if (!text.includes('class'))
    return
  for (const m of text.matchAll(STATIC_CLASS_RE))
    add(m[2]!)
  for (const m of text.matchAll(JSX_CLASS_RE))
    add(m[2]!)
  for (const m of text.matchAll(VUE_CLASS_RE)) {
    const expression = m[2]!
    const tokens: { kind: 'string' | 'other', text: string, start: number }[] = []
    scanScript(expression, {
      word: (start, end) => tokens.push({ kind: 'other', text: expression.slice(start, end), start }),
      string: (start, end) => tokens.push({ kind: 'string', text: expression.slice(start, end), start }),
      punct: at => tokens.push({ kind: 'other', text: expression[at]!, start: at }),
    })
    tokens.forEach((token, k) => {
      const closed = token.text.length >= 2 && token.text.at(-1) === token.text[0]
      // Операнд сравнения (`size === 'lg'`) — значение, а не класс.
      const compared = /^[=!<>]$/.test(tokens[k - 1]?.text ?? '') || /^[=!<>]$/.test(tokens[k + 1]?.text ?? '')
      if (token.kind === 'string' && closed && !compared)
        add(token.text.slice(1, -1))
    })
  }
}

/** Литерал как текст: кавычки и обратный слеш — сами собой, перевод строки и табуляция — пробел. */
function unescapeLiteral(text: string): string {
  return text.replace(/\\(?:([\\"'`])|[nrt])/g, (_, ch: string | undefined) => ch ?? ' ')
}

/**
 * Разметка в JS-коде — только литералы: строки и статический текст шаблонных
 * строк. Регэксп-литерал и код атрибутом не бывают, а значение атрибута не
 * выходит за границу литерала.
 */
function collectFromScript(code: string, add: AddValue): void {
  scanScript(code, {
    string: (start, end) => {
      const closed = end - start >= 2 && code[end - 1] === code[start]
      collectFromMarkup(unescapeLiteral(code.slice(start + 1, closed ? end - 1 : end)), add)
    },
    template: (start, end) => collectFromMarkup(unescapeLiteral(code.slice(start, end)), add),
  })
}

/**
 * Классы из атрибутов разметки приложения — то, что автор точно написал как
 * класс, в отличие от прочих слов исходников. Значение со вставкой (`{{ }}`,
 * `{…}`, `${…}`) не берётся: класс там собирается на лету. В Vue-выражении
 * `:class` берутся строковые литералы, кроме операндов сравнения; имена без
 * кавычек — нет: `{ active: on }` может быть и не классом.
 *
 * Где в файле разметка, решает его вид. В JS/TS — только литералы: строка с
 * HTML судится, регэксп `/class="…/` и код вокруг — нет. В SFC, HTML и Astro —
 * текст вне `<script>` и frontmatter, а их тела читаются как JS/TS. JSX
 * (`.jsx`, `.tsx`, `<script lang="tsx">`) читается текстом целиком: разметка
 * там сам код, а без парсера JSX закрывающий тег `</p>` от начала регэкспа не
 * отличить, и граница по лексемам теряла бы настоящие атрибуты.
 */
export function collectClassAttributes(code: string, file: string): string[] {
  const source = stripComments(code, file)
  const out = new Set<string>()
  const add = (value: string): void => {
    if (/[{}]|\$\{/.test(value))
      return
    for (const name of value.split(/\s+/)) {
      if (name)
        out.add(name)
    }
  }
  if (SCRIPT_FILE_RE.test(file)) {
    collectFromScript(source, add)
  }
  else if (MARKUP_FILE_RE.test(file)) {
    const frontmatter = /\.astro$/i.test(file) ? FRONTMATTER_RE.exec(source) : null
    if (frontmatter)
      collectFromScript(frontmatter[1]!, add)
    const markup = source.slice(frontmatter?.[0].length ?? 0).replace(SCRIPT_BLOCK_RE, (block: string, attrs: string, body: string) => {
      if (!isScriptBlock(attrs))
        return block
      collectFromScript(body, add)
      return ''
    })
    collectFromMarkup(markup, add)
  }
  else {
    collectFromMarkup(source, add)
  }
  return [...out].sort()
}

export function scanAppSources(config: GranumAppSources | undefined, root: string, engine: GranumEngine): AppSourcesScan {
  if (!config)
    return { files: [], classes: [], consumes: [], componentImports: [], componentTags: [], classAttributes: {}, declaredClasses: [] }
  const extensions = config.extensions ?? DEFAULT_APP_EXTENSIONS
  const files: string[] = []
  const classes = new Set<string>()
  const consumes = new Set<string>()
  const imports = new Set<string>()
  const tags = new Set<string>()
  const classAttributes: Record<string, string[]> = {}
  const declaredClasses = new Set<string>()

  for (const dir of config.dirs) {
    for (const file of listSourceFiles(resolve(root, dir), extensions)) {
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      }
      catch {
        continue
      }
      files.push(file)
      if (!file.endsWith('.css')) {
        for (const token of engine.extract(text, file))
          classes.add(token)
        // Закомментированный импорт — не импорт.
        for (const m of stripComments(text, file).matchAll(COMPONENT_IMPORT_RE))
          imports.add(`${m[1]}:${m[2]}`)
        for (const m of text.matchAll(COMPONENT_TAG_RE))
          tags.add(m[1]!)
        for (const name of collectClassAttributes(text, file))
          (classAttributes[name] ??= []).push(file)
      }
      else if (!file.endsWith('.module.css')) {
        for (const name of declaredCssClasses(text))
          declaredClasses.add(name)
      }
      const scan = scanTokenConsumption(text, file)
      for (const name of scan.uses.keys())
        consumes.add(`--${name}`)
      for (const name of scan.literals)
        consumes.add(`--${name}`)
    }
  }

  return { files, classes: sortedUnique(classes), consumes: sortedUnique(consumes), componentImports: sortedUnique(imports), componentTags: sortedUnique(tags), classAttributes, declaredClasses: sortedUnique(declaredClasses) }
}
