/**
 * Блоки `@layer <prefix>.<name>{…}` в собранном CSS (A-19): размеры слоёв в
 * отчёте считаются по тому, что реально уехало в бандл после минификации, а
 * не по эмиссии. Сканер учитывает строки и комментарии, вложенные at-rules —
 * по балансу скобок.
 */

export interface LayerBlocks {
  /** Имя слоя → конкатенация всех его блоков (минификатор может разнести слой на несколько). */
  readonly blocks: ReadonlyMap<string, string>
  /** Вводные объявления порядка `@layer a, b;` — тоже байты granum. */
  readonly statements: readonly string[]
}

function skipString(css: string, i: number): number {
  const quote = css[i]
  let j = i + 1
  while (j < css.length) {
    if (css[j] === '\\') {
      j += 2
      continue
    }
    if (css[j] === quote)
      return j + 1
    j++
  }
  return css.length
}

function skipComment(css: string, i: number): number {
  const end = css.indexOf('*/', i + 2)
  return end < 0 ? css.length : end + 2
}

/** Индекс закрывающей `}` блока, открытого на `open`. */
function blockEnd(css: string, open: number): number {
  let depth = 0
  let i = open
  while (i < css.length) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      i = skipComment(css, i)
      continue
    }
    if (c === '"' || c === '\'') {
      i = skipString(css, i)
      continue
    }
    if (c === '{') {
      depth++
    }
    else if (c === '}') {
      depth--
      if (depth === 0)
        return i
    }
    i++
  }
  return css.length
}

export function extractLayerBlocks(css: string, prefix: string): LayerBlocks {
  const blocks = new Map<string, string>()
  const statements: string[] = []
  const re = /@layer([^{;]*)([{;])/g
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(css)) !== null) {
    const names = m[1]!.split(',').map(s => s.trim()).filter(Boolean)
    if (names.length === 0)
      continue
    if (m[2] === ';') {
      if (names.every(n => n.startsWith(`${prefix}.`)))
        statements.push(m[0])
      continue
    }
    const open = m.index + m[0].length - 1
    const close = blockEnd(css, open)
    const single = names[0]!
    if (names.length === 1 && single.startsWith(`${prefix}.`)) {
      const name = single.slice(prefix.length + 1)
      blocks.set(name, (blocks.get(name) ?? '') + css.slice(m.index, close + 1))
      re.lastIndex = close + 1
      continue
    }
    // Чужой или вложенный `@layer` — внутрь не заходим, пропускаем блок целиком.
    re.lastIndex = close + 1
  }
  return { blocks, statements }
}
