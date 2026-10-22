/**
 * Значения токенов по блокам собранного CSS: правило — его список селекторов,
 * объявления и at-правила, внутри которых оно стоит. Блок под `@supports` —
 * фолбэк, а не значение пары: он отдельно.
 */
export function ruleBlocks(css) {
  const out = []
  const stack = []
  let start = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      stack.push(css.slice(start, i).trim())
      start = i + 1
    }
    else if (css[i] === '}') {
      const prelude = stack.pop()
      if (prelude !== undefined && !prelude.startsWith('@')) {
        const declarations = new Map()
        for (const part of css.slice(start, i).split(';')) {
          const at = part.indexOf(':')
          if (at > 0)
            declarations.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
        }
        out.push({ selectors: prelude.split(',').map(s => s.trim()), declarations, at: stack.filter(p => p.startsWith('@')) })
      }
      start = i + 1
    }
  }
  return out
}

/** Значение токена под селектором вне `@supports`: последнее объявление побеждает. `undefined` — нет. */
export function tokenValue(css, selector, token) {
  let value
  for (const block of ruleBlocks(css)) {
    if (block.selectors.includes(selector) && !block.at.some(p => p.startsWith('@supports')) && block.declarations.has(token))
      value = block.declarations.get(token)
  }
  return value
}

/**
 * Все объявления токенов (`--x`): ключ — at-правила и селекторы блока, значение —
 * токены блока с их значениями. Точный состав, а не поиск по имени: так видно
 * и лишний токен, и токен не под тем селектором.
 */
export function declaredTokens(css, ignore = []) {
  const out = {}
  for (const block of ruleBlocks(css)) {
    const key = [...block.at, block.selectors.join(',')].join(' ')
    for (const [name, value] of block.declarations) {
      if (name.startsWith('--') && !ignore.some(pattern => pattern.test(name)))
        (out[key] ??= {})[name] = value
    }
  }
  return out
}
