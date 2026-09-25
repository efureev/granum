/**
 * Нормализация CSS в множество правил `{ context, selector, declarations }`
 * — чистые функции для `compare-css.mjs` (AC-2). Обёртки `@layer` снимаются:
 * они — способ доставки, а не содержание. `@media`/`@supports`/`@container`
 * входят в контекст правила, `@keyframes` — одно правило с телом целиком.
 */

const RULE_AT_RULES = /^@(?:media|supports|container|layer|document)\b/

function skipComment(css, i) {
  const end = css.indexOf('*/', i + 2)
  return end < 0 ? css.length : end + 2
}

/** Индекс закрывающей `}` для блока, открытого на `open`. */
function blockEnd(css, open) {
  let depth = 0
  let i = open
  while (i < css.length) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      i = skipComment(css, i)
      continue
    }
    if (c === '"' || c === '\'') {
      const quote = c
      i++
      while (i < css.length && css[i] !== quote) {
        if (css[i] === '\\')
          i++
        i++
      }
      i++
      continue
    }
    if (c === '{')
      depth++
    else if (c === '}' && --depth === 0)
      return i
    i++
  }
  return css.length
}

export function normalizeSelector(selector) {
  return selector.replace(/\s+/g, ' ').replace(/\s*([>+~,])\s*/g, '$1').trim()
}

export function normalizeDeclarations(body) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= body.length; i++) {
    const c = body[i]
    if (c === '(')
      depth++
    else if (c === ')')
      depth--
    if ((c === ';' && depth === 0) || i === body.length) {
      const decl = body.slice(start, i).trim()
      start = i + 1
      if (!decl)
        continue
      const colon = decl.indexOf(':')
      if (colon < 0)
        continue
      const prop = decl.slice(0, colon).trim().toLowerCase()
      const value = decl.slice(colon + 1).replace(/\s+/g, ' ').trim()
      out.push(`${prop}:${value}`)
    }
  }
  return [...new Set(out)].sort()
}

/**
 * Все правила текста CSS. Ключ правила — `context|selector`; значение —
 * отсортированные объявления (или тело `@keyframes` как есть).
 */
export function collectCssRules(css, context = '') {
  const rules = new Map()
  let i = 0
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  while (i < source.length) {
    const open = source.indexOf('{', i)
    const semi = source.indexOf(';', i)
    if (open < 0)
      break
    // Statement без блока (`@layer a, b;`, `@import …;`) — не правило.
    if (semi >= 0 && semi < open) {
      i = semi + 1
      continue
    }
    const prelude = normalizeSelector(source.slice(i, open))
    const close = blockEnd(source, open)
    const body = source.slice(open + 1, close)
    i = close + 1
    if (!prelude)
      continue
    if (prelude.startsWith('@layer')) {
      merge(rules, collectCssRules(body, context))
      continue
    }
    if (RULE_AT_RULES.test(prelude)) {
      merge(rules, collectCssRules(body, context ? `${context} ${prelude}` : prelude))
      continue
    }
    if (prelude.startsWith('@keyframes') || prelude.startsWith('@font-face') || prelude.startsWith('@property')) {
      addRule(rules, `${context}|${prelude}`, [body.replace(/\s+/g, ' ').trim()])
      continue
    }
    for (const selector of prelude.split(','))
      addRule(rules, `${context}|${normalizeSelector(selector)}`, normalizeDeclarations(body))
  }
  return rules
}

function addRule(rules, key, declarations) {
  const existing = rules.get(key)
  rules.set(key, existing ? [...new Set([...existing, ...declarations])].sort() : declarations)
}

function merge(into, from) {
  for (const [key, declarations] of from)
    addRule(into, key, declarations)
}

/** Разница множеств правил: только слева, только справа, разные объявления. */
export function diffCssRules(left, right) {
  const onlyLeft = []
  const onlyRight = []
  const changed = []
  for (const [key, decls] of left) {
    const other = right.get(key)
    if (!other)
      onlyLeft.push(key)
    else if (decls.join(';') !== other.join(';'))
      changed.push({ key, left: decls, right: other })
  }
  for (const key of right.keys()) {
    if (!left.has(key))
      onlyRight.push(key)
  }
  return { onlyLeft: onlyLeft.sort(), onlyRight: onlyRight.sort(), changed: changed.sort((a, b) => a.key.localeCompare(b.key)) }
}
