/** Спецификаторы импортов собранного модуля — для проверок границы на `dist`. */
import { builtinModules } from 'node:module'
import { scanScript } from '../engine/extract'

const NODE_BUILTINS = new Set(builtinModules)
const GRANUM_NODE_ENTRY_RE = /^@feugene\/granum\/(?:build|vite|node|codegen)(?:\/|$)/

interface Token {
  readonly kind: 'word' | 'string' | 'punct'
  readonly text: string
}

/** Лексемы кода модуля: слова, строки в кавычках и прочие символы вне литералов. */
function scriptTokens(code: string): Token[] {
  const tokens: Token[] = []
  scanScript(code, {
    word: (start, end) => tokens.push({ kind: 'word', text: code.slice(start, end) }),
    string: (start, end) => tokens.push({ kind: 'string', text: code.slice(start, end) }),
    punct: at => tokens.push({ kind: 'punct', text: code[at]! }),
  })
  return tokens
}

function isToken(tokens: readonly Token[], k: number, kind: Token['kind'], text?: string): boolean {
  return tokens[k]?.kind === kind && (text === undefined || tokens[k]!.text === text)
}

/** Содержимое закрытой строки без пробелов: иначе это не спецификатор. */
function specifierAt(tokens: readonly Token[], k: number): string | undefined {
  const token = tokens[k]
  if (token?.kind !== 'string' || token.text.length < 2 || token.text.at(-1) !== token.text[0])
    return undefined
  const value = token.text.slice(1, -1)
  return /^[^\s'"`\\]+$/.test(value) ? value : undefined
}

/** Слово-ключ, а не свойство (`a.from`), не `import.meta` и не CSS `@import`. */
function isKeyword(tokens: readonly Token[], k: number, text: string): boolean {
  return isToken(tokens, k, 'word', text) && !isToken(tokens, k - 1, 'punct', '.') && !isToken(tokens, k - 1, 'punct', '@')
}

/**
 * Спецификаторы импортов модуля: строка сразу за `from` и `import`, первый
 * аргумент `import(…)` и `require(…)`. Ищутся по лексемам кода, а не текстом:
 * «from '…'» в строке, шаблоне, регэкспе или комментарии — не импорт, а
 * `/*` внутри `'./icons/*.svg'` не съедает импорты дальше по файлу.
 */
export function collectImportSpecifiers(code: string): string[] {
  const tokens = scriptTokens(code)
  const out = new Set<string>()
  for (let k = 0; k < tokens.length; k++) {
    let specifier: string | undefined
    if (isKeyword(tokens, k, 'from') || isKeyword(tokens, k, 'import'))
      specifier = specifierAt(tokens, k + 1)
    if (specifier === undefined && (isKeyword(tokens, k, 'import') || isKeyword(tokens, k, 'require'))
      && isToken(tokens, k + 1, 'punct', '(') && (isToken(tokens, k + 3, 'punct', ')') || isToken(tokens, k + 3, 'punct', ','))) {
      specifier = specifierAt(tokens, k + 2)
    }
    if (specifier !== undefined)
      out.add(specifier)
  }
  return [...out].sort()
}

/** Импорт из корня пакета-провайдера: компоненты по имени либо весь пакет разом. */
export interface PackageRootImport {
  readonly providerId: string
  /** Компоненты провайдера, взятые из корня по имени. */
  readonly components: readonly string[]
  /** `import * as`, `export * from` или `import()` корня: тянут пакет целиком. */
  readonly whole: boolean
}

/**
 * Импорты компонентов из корня пакета-провайдера. Компонент приложение берёт из
 * подпути `<пакет>/components/<Имя>` или из `virtual:granum/components`: по
 * подпути его видят селекция и guard, а корневой barrel тянет весь пакет — в
 * dev и в SSR это все его компоненты.
 *
 * Нарушение — именованный импорт или реэкспорт компонента из корня и любой
 * импорт корня целиком (`import * as`, `export * from`, `import()`). Прочие
 * имена корня, импорт по умолчанию, импорт ради побочного эффекта и импорт
 * одних типов — не нарушение.
 *
 * @param code код модуля приложения
 * @param providers id провайдера → имена его компонентов
 */
export function findPackageRootImports(code: string, providers: ReadonlyMap<string, ReadonlySet<string>>): PackageRootImport[] {
  const tokens = scriptTokens(code)
  const found = new Map<string, { components: Set<string>, whole: boolean }>()
  const record = (providerId: string, names: readonly string[], whole: boolean): void => {
    const components = providers.get(providerId)
    if (!components)
      return
    const hits = names.filter(name => components.has(name))
    if (!whole && hits.length === 0)
      return
    const entry = found.get(providerId) ?? { components: new Set<string>(), whole: false }
    hits.forEach(name => entry.components.add(name))
    entry.whole ||= whole
    found.set(providerId, entry)
  }
  /** Имена из `{ A, B as C, type D }` с позиции `{`; `end` — за `}`. */
  const namedList = (open: number): { names: string[], end: number } => {
    const names: string[] = []
    let j = open + 1
    let entryStart = true
    while (j < tokens.length && !isToken(tokens, j, 'punct', '}')) {
      if (isToken(tokens, j, 'punct', ',')) {
        entryStart = true
      }
      else if (entryStart && tokens[j]!.kind === 'word') {
        entryStart = false
        // `type A` — импорт типа; `default as X` — импорт по умолчанию.
        const typeOnly = tokens[j]!.text === 'type' && isToken(tokens, j + 1, 'word') && tokens[j + 1]!.text !== 'as'
        if (!typeOnly && tokens[j]!.text !== 'default')
          names.push(tokens[j]!.text)
      }
      j++
    }
    return { names, end: j + 1 }
  }
  /** Спецификатор за `from` на позиции `j`, если `from` стоит там. */
  const fromAt = (j: number): string | undefined => (isToken(tokens, j, 'word', 'from') ? specifierAt(tokens, j + 1) : undefined)

  for (let k = 0; k < tokens.length; k++) {
    if (isKeyword(tokens, k, 'import')) {
      if (isToken(tokens, k + 1, 'punct', '(')) {
        const specifier = specifierAt(tokens, k + 2)
        if (specifier !== undefined && (isToken(tokens, k + 3, 'punct', ')') || isToken(tokens, k + 3, 'punct', ',')))
          record(specifier, [], true)
        continue
      }
      // `import 'pkg'` — ради побочного эффекта; `import type …` — одни типы.
      if (isToken(tokens, k + 1, 'string'))
        continue
      if (isToken(tokens, k + 1, 'word', 'type') && !isToken(tokens, k + 2, 'punct', ',') && !isToken(tokens, k + 2, 'word', 'from'))
        continue
      const names: string[] = []
      let whole = false
      let j = k + 1
      while (j < tokens.length && !isToken(tokens, j, 'word', 'from') && !isToken(tokens, j, 'punct', ';') && j - k < 500) {
        if (isToken(tokens, j, 'punct', '*')) {
          whole = true
          j++
        }
        else if (isToken(tokens, j, 'punct', '{')) {
          const list = namedList(j)
          names.push(...list.names)
          j = list.end
        }
        else {
          j++
        }
      }
      const specifier = fromAt(j)
      if (specifier !== undefined)
        record(specifier, names, whole)
    }
    else if (isKeyword(tokens, k, 'export')) {
      if (isToken(tokens, k + 1, 'punct', '*')) {
        // `export * from 'pkg'` и `export * as ns from 'pkg'`.
        const specifier = fromAt(isToken(tokens, k + 2, 'word', 'as') ? k + 4 : k + 2)
        if (specifier !== undefined)
          record(specifier, [], true)
      }
      else if (isToken(tokens, k + 1, 'punct', '{')) {
        const list = namedList(k + 1)
        const specifier = fromAt(list.end)
        if (specifier !== undefined)
          record(specifier, list.names, false)
      }
    }
  }
  return [...found].map(([providerId, { components, whole }]) => ({ providerId, components: [...components].sort(), whole }))
}

export function boundaryKindOf(specifier: string): 'node-import' | 'granum-node-entry' | undefined {
  if (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier))
    return 'node-import'
  if (GRANUM_NODE_ENTRY_RE.test(specifier))
    return 'granum-node-entry'
  return undefined
}
