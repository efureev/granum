/**
 * Поиск токенов в тексте (B-9, INV-MAN-6). Четыре вопроса, три канала:
 *
 *   - `var(--x` — где угодно: CSS, шаблон, строковый литерал чанка,
 *     арбитражное значение утилиты; вложенные `var(--a, var(--b))` дают оба;
 *   - имя целиком в строковом литерале (`'--x'`) — ключ инлайн-стиля, аргумент
 *     `setProperty`, имя, подставляемое в `var()` через переменную. Только для
 *     JS/TS/Vue: в CSS `--x` — объявление, а не ссылка;
 *   - **присваивание** `--x:` — в CSS-правиле или ключом инлайн-стиля. Канал
 *     нужен диагностике: токен, который компонент выставляет сам, для него не
 *     «неопределённый», даже если ни один слой granum его не задаёт (T-5).
 */

import { stripComments } from '../engine/extract'

/**
 * `var(--x` с разбором того, что идёт сразу после имени:
 *
 *   - группа 2 — имя собирается в рантайме: `var(--gr-${'{'}tone${'}'}-text)` или
 *     `'var(--gr-' + tone + '-text)'`. Токена с таким именем не существует, и
 *     считать префикс потреблением нельзя — про такие имена компонент
 *     объявляет `dynamicTokens`;
 *   - группа 3 — запятая, то есть у потребления есть fallback.
 */
const VAR_USE_RE = /var\(\s*--([\w-]+)(\$\{|['"`])?\s*(,)?/g
const VAR_LITERAL_RE = /(['"`])(--[\w-]+)\1/g
/**
 * Присваивание: `--x: value` в CSS, `'--x': value` ключом объекта стиля и
 * `[--x:value]` — утилита с произвольным значением, которой компонент выставляет
 * свой токен в разметке. `var(--x)` под это не попадает: там перед именем
 * стоит `(`.
 */
const VAR_ASSIGN_RE = /(?:^|[\s;{,['"])--([\w-]+)['"]?\s*:/g

/** Имя (без `--`) → есть ли хотя бы одно потребление с fallback. */
export function extractTokenUses(text: string): Map<string, boolean> {
  const found = new Map<string, boolean>()
  for (const match of text.matchAll(VAR_USE_RE)) {
    if (match[2] !== undefined)
      continue
    const name = match[1]!
    found.set(name, (found.get(name) ?? false) || match[3] !== undefined)
  }
  return found
}

/**
 * Имена (без `--`), у которых есть хотя бы одно потребление **без** fallback.
 *
 * Отдельная функция, потому что вопрос другой: `extractTokenUses` отвечает
 * «бывает ли фолбэк», эта — «бывает ли его отсутствие». Токен, у которого фолбэк
 * есть всегда, молча не покрасить нельзя: значение по умолчанию записано в самом
 * `var()`, и отсутствие внешнего объявления дефектом не является.
 */
export function extractRequiredTokenUses(text: string): Set<string> {
  const found = new Set<string>()
  for (const match of text.matchAll(VAR_USE_RE)) {
    if (match[2] === undefined && match[3] === undefined)
      found.add(match[1]!)
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

/** Имена токенов (без `--`), которым текст присваивает значение. */
export function extractTokenAssignments(text: string): Set<string> {
  const found = new Set<string>()
  for (const match of text.matchAll(VAR_ASSIGN_RE))
    found.add(match[1]!)
  return found
}

/** В CSS спецсимволы имени класса экранированы (`.bg-\[var\(--x\)\]`). */
export function unescapeCss(css: string): string {
  return css.replace(/\\(.)/g, '$1')
}

/**
 * Объединённый разбор файла с учётом типа: литералы только вне CSS.
 *
 * Комментарии срезаются тем же хелпером, что у экстрактора классов (INV-ENG-5).
 * Иначе документация про токен превращается в его потребление: JSDoc, в котором
 * написано ``var(--gr-z-*)`` или ``var(--gr-avatar-${'{'}n${'}'}-bg)``, давал
 * фантомный токен с именем-префиксом, и объявить такой не мог никто. Экстрактор
 * классов комментарии срезал всегда, сканер токенов — нет, и расхождение было
 * без причины.
 */
export function scanTokenConsumption(text: string, id: string): {
  uses: Map<string, boolean>
  literals: Set<string>
  /** Потребления без fallback: значение обязан дать кто-то извне. */
  required: Set<string>
  /** Присваивания в этом же тексте: значение даёт сам компонент. */
  assigns: Set<string>
} {
  const isCss = /\.css$/i.test(id)
  const stripped = stripComments(text, id)
  const source = isCss ? unescapeCss(stripped) : stripped
  return {
    uses: extractTokenUses(source),
    literals: isCss ? new Set() : extractTokenLiterals(source),
    required: extractRequiredTokenUses(source),
    assigns: extractTokenAssignments(source),
  }
}
