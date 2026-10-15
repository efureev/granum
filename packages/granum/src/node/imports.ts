/** Спецификаторы импортов собранного модуля — для проверок границы на `dist`. */
import { builtinModules } from 'node:module'
import { scanScript } from '../engine/extract'

const NODE_BUILTINS = new Set(builtinModules)
const GRANUM_NODE_ENTRY_RE = /^@feugene\/granum\/(?:build|vite|node|codegen)(?:\/|$)/

interface Token {
  readonly kind: 'word' | 'string' | 'punct'
  readonly text: string
}

/**
 * Спецификаторы импортов модуля: строка сразу за `from` и `import`, первый
 * аргумент `import(…)` и `require(…)`. Ищутся по лексемам кода, а не текстом:
 * «from '…'» в строке, шаблоне, регэкспе или комментарии — не импорт, а
 * `/*` внутри `'./icons/*.svg'` не съедает импорты дальше по файлу.
 */
export function collectImportSpecifiers(code: string): string[] {
  const tokens: Token[] = []
  scanScript(code, {
    word: (start, end) => tokens.push({ kind: 'word', text: code.slice(start, end) }),
    string: (start, end) => tokens.push({ kind: 'string', text: code.slice(start, end) }),
    punct: at => tokens.push({ kind: 'punct', text: code[at]! }),
  })
  const is = (k: number, kind: Token['kind'], text?: string): boolean =>
    tokens[k]?.kind === kind && (text === undefined || tokens[k]!.text === text)
  /** Содержимое закрытой строки без пробелов: иначе это не спецификатор. */
  const specifierAt = (k: number): string | undefined => {
    const token = tokens[k]
    if (token?.kind !== 'string' || token.text.length < 2 || token.text.at(-1) !== token.text[0])
      return undefined
    const value = token.text.slice(1, -1)
    return /^[^\s'"`\\]+$/.test(value) ? value : undefined
  }

  const out = new Set<string>()
  for (let k = 0; k < tokens.length; k++) {
    const { kind, text } = tokens[k]!
    // `a.from(…)`, `loader.require(…)`, `import.meta` и CSS `@import` — не импорт модуля.
    if (kind !== 'word' || is(k - 1, 'punct', '.') || is(k - 1, 'punct', '@'))
      continue
    let specifier: string | undefined
    if (text === 'from' || text === 'import')
      specifier = specifierAt(k + 1)
    if (specifier === undefined && (text === 'import' || text === 'require') && is(k + 1, 'punct', '(')
      && (is(k + 3, 'punct', ')') || is(k + 3, 'punct', ','))) {
      specifier = specifierAt(k + 2)
    }
    if (specifier !== undefined)
      out.add(specifier)
  }
  return [...out].sort()
}

export function boundaryKindOf(specifier: string): 'node-import' | 'granum-node-entry' | undefined {
  if (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier))
    return 'node-import'
  if (GRANUM_NODE_ENTRY_RE.test(specifier))
    return 'granum-node-entry'
  return undefined
}
