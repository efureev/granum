/**
 * Поиск потребления токенов в тексте (B-9, INV-MAN-6). Два канала:
 *
 *   - `var(--x` — где угодно: CSS, шаблон, строковый литерал чанка,
 *     арбитражное значение утилиты; вложенные `var(--a, var(--b))` дают оба;
 *   - имя целиком в строковом литерале (`'--x'`) — ключ инлайн-стиля, аргумент
 *     `setProperty`, имя, подставляемое в `var()` через переменную. Только для
 *     JS/TS/Vue: в CSS `--x` — объявление, а не ссылка.
 */

const VAR_USE_RE = /var\(\s*--([\w-]+)\s*(,)?/g
const VAR_LITERAL_RE = /(['"`])(--[\w-]+)\1/g

/** Имя (без `--`) → есть ли хотя бы одно потребление с fallback. */
export function extractTokenUses(text: string): Map<string, boolean> {
  const found = new Map<string, boolean>()
  for (const match of text.matchAll(VAR_USE_RE)) {
    const name = match[1]!
    found.set(name, (found.get(name) ?? false) || match[2] !== undefined)
  }
  return found
}

/** Имена токенов (без `--`), записанные строковым литералом целиком. */
export function extractTokenLiterals(text: string): Set<string> {
  const found = new Set<string>()
  for (const match of text.matchAll(VAR_LITERAL_RE))
    found.add(match[2]!.slice(2))
  return found
}

/** В CSS спецсимволы имени класса экранированы (`.bg-\[var\(--x\)\]`). */
export function unescapeCss(css: string): string {
  return css.replace(/\\(.)/g, '$1')
}

/** Объединённое потребление файла с учётом типа: литералы только вне CSS. */
export function scanTokenConsumption(text: string, id: string): { uses: Map<string, boolean>, literals: Set<string> } {
  const isCss = /\.css$/i.test(id)
  const source = isCss ? unescapeCss(text) : text
  return {
    uses: extractTokenUses(source),
    literals: isCss ? new Set() : extractTokenLiterals(source),
  }
}
