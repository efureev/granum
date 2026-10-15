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

/** Статический `class="…"` или `className="…"`: перед именем — не `:`, `@`, `.`, `-` и не буква. */
const STATIC_CLASS_RE = /(?<![\w:@.-])(?:class|className)\s*=\s*(["'])([\s\S]*?)\1/g
/** JSX: `className={'…'}`, `className={"…"}`, `` className={`…`} ``. */
const JSX_CLASS_RE = /(?<![\w:@.-])className\s*=\s*\{\s*(["'`])([\s\S]*?)\1\s*\}/g
/** Vue: `:class="…"` и `v-bind:class="…"` — выражение, а не список классов. */
const VUE_CLASS_RE = /(?<![\w@.-])(?::|v-bind:)class\s*=\s*(["'])([\s\S]*?)\1/g

/**
 * Классы из атрибутов разметки приложения — то, что автор точно написал как
 * класс, в отличие от прочих слов исходников. Значение со вставкой (`{{ }}`,
 * `{…}`, `${…}`) не берётся: класс там собирается на лету. В Vue-выражении
 * `:class` берутся строковые литералы, кроме операндов сравнения; имена без
 * кавычек — нет: `{ active: on }` может быть и не классом.
 */
export function collectClassAttributes(code: string, file: string): string[] {
  const source = stripComments(code, file)
  const out = new Set<string>()
  const addValue = (value: string): void => {
    if (/[{}]|\$\{/.test(value))
      return
    for (const name of value.split(/\s+/)) {
      if (name)
        out.add(name)
    }
  }
  for (const m of source.matchAll(STATIC_CLASS_RE))
    addValue(m[2]!)
  for (const m of source.matchAll(JSX_CLASS_RE))
    addValue(m[2]!)
  for (const m of source.matchAll(VUE_CLASS_RE)) {
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
        addValue(token.text.slice(1, -1))
    })
  }
  return [...out].sort()
}

export function scanAppSources(config: GranumAppSources | undefined, root: string, engine: GranumEngine): AppSourcesScan {
  if (!config)
    return { files: [], classes: [], consumes: [], componentImports: [], componentTags: [], classAttributes: {} }
  const extensions = config.extensions ?? DEFAULT_APP_EXTENSIONS
  const files: string[] = []
  const classes = new Set<string>()
  const consumes = new Set<string>()
  const imports = new Set<string>()
  const tags = new Set<string>()
  const classAttributes: Record<string, string[]> = {}

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
      const scan = scanTokenConsumption(text, file)
      for (const name of scan.uses.keys())
        consumes.add(`--${name}`)
      for (const name of scan.literals)
        consumes.add(`--${name}`)
    }
  }

  return { files, classes: sortedUnique(classes), consumes: sortedUnique(consumes), componentImports: sortedUnique(imports), componentTags: sortedUnique(tags), classAttributes }
}
