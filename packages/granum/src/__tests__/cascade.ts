/**
 * Каскад кастомных свойств для тестов слоёв темы: какое значение токена получит
 * элемент в браузере с заданными условиями `@supports` и системной схемой.
 * Понимает только то, что выводит сборщик тем: правила, `@supports`,
 * `@media (prefers-color-scheme: …)` и селекторы из `:root`, `:not(…)` и
 * атрибутов. Остальное — ошибка: молча не совпавший селектор доказал бы что угодно.
 */

export interface CascadeAt {
  /** Значение атрибута активации на `<html>`; без него атрибута нет. */
  readonly root?: string
  /** Значение атрибута на острове внутри `<html>`: считается остров, а не корень. */
  readonly island?: string
  /** Условия `@supports`, истинные в этом браузере, — дословно как в CSS. */
  readonly supports?: readonly string[]
  readonly scheme?: 'light' | 'dark'
  readonly attribute?: string
}

interface Rule {
  readonly selectors: readonly string[]
  readonly declarations: readonly (readonly [string, string])[]
}

interface Element {
  readonly root: boolean
  readonly value: string | undefined
}

function condition(prelude: string, at: CascadeAt): boolean {
  if (prelude.startsWith('@supports '))
    return (at.supports ?? []).includes(prelude.slice('@supports '.length).trim())
  const media = /^@media\s+\(prefers-color-scheme:\s*(light|dark)\)$/.exec(prelude)
  if (media)
    return media[1] === (at.scheme ?? 'light')
  throw new Error(`cascade: unsupported at-rule "${prelude}"`)
}

/** Правила, действующие в этом браузере, в порядке исходника. */
function parseRules(css: string, at: CascadeAt): Rule[] {
  if (css.includes('/*'))
    throw new Error('cascade: comments are not supported')
  const rules: Rule[] = []
  let i = 0
  const block = (active: boolean): void => {
    while (i < css.length) {
      const open = css.indexOf('{', i)
      const close = css.indexOf('}', i)
      if (close !== -1 && (open === -1 || close < open)) {
        i = close + 1
        return
      }
      if (open === -1) {
        if (css.slice(i).trim())
          throw new Error(`cascade: trailing text "${css.slice(i).trim()}"`)
        i = css.length
        return
      }
      const prelude = css.slice(i, open).trim()
      i = open + 1
      if (prelude.startsWith('@')) {
        block(active && condition(prelude, at))
        continue
      }
      const end = css.indexOf('}', i)
      const body = css.slice(i, end)
      i = end + 1
      if (!active)
        continue
      const declarations = body.split(';').map(d => d.trim()).filter(Boolean).map((d) => {
        const colon = d.indexOf(':')
        return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()] as const
      })
      rules.push({ selectors: prelude.split(',').map(s => s.trim()), declarations })
    }
  }
  block(true)
  return rules
}

type Simple
  = | { readonly kind: 'root' }
    | { readonly kind: 'not', readonly inner: readonly Simple[] }
    | { readonly kind: 'attr', readonly op?: '=' | '^=', readonly value?: string }

/** Составной селектор по простым: `:root`, `:not(…)`, атрибут активации. */
function parseCompound(selector: string, attribute: string): Simple[] {
  const out: Simple[] = []
  let rest = selector
  while (rest) {
    if (rest.startsWith(':root')) {
      out.push({ kind: 'root' })
      rest = rest.slice(':root'.length)
      continue
    }
    if (rest.startsWith(':not(')) {
      const end = rest.indexOf(')')
      out.push({ kind: 'not', inner: parseCompound(rest.slice(':not('.length, end), attribute) })
      rest = rest.slice(end + 1)
      continue
    }
    const attr = /^\[([\w-]+)(?:(\^?=)"([^"\\]*)")?\]/.exec(rest)
    if (!attr)
      throw new Error(`cascade: unsupported selector "${selector}"`)
    if (attr[1] !== attribute)
      throw new Error(`cascade: unexpected attribute "${attr[1]}"`)
    out.push(attr[2] === undefined ? { kind: 'attr' } : { kind: 'attr', op: attr[2] as '=' | '^=', value: attr[3]! })
    rest = rest.slice(attr[0].length)
  }
  return out
}

function matchesSimple(simple: Simple, element: Element): boolean {
  if (simple.kind === 'root')
    return element.root
  if (simple.kind === 'not')
    return !matches(simple.inner, element)
  if (element.value === undefined)
    return false
  if (simple.op === undefined)
    return true
  return simple.op === '=' ? element.value === simple.value : element.value.startsWith(simple.value!)
}

function matches(compound: readonly Simple[], element: Element): boolean {
  return compound.every(simple => matchesSimple(simple, element))
}

/** Все простые селектора здесь — уровня класса: специфичность — их число, `:not` — по аргументу. */
function weight(compound: readonly Simple[]): number {
  return compound.reduce((sum, simple) => sum + (simple.kind === 'not' ? weight(simple.inner) : 1), 0)
}

/** Победители слоя по свойству: выше специфичность, при равной — позже в исходнике. */
function applyLayer(target: Map<string, string>, rules: readonly Rule[], element: Element, attribute: string): void {
  const winners = new Map<string, { specificity: number, value: string }>()
  for (const rule of rules) {
    const matched = rule.selectors.map(s => parseCompound(s, attribute)).filter(c => matches(c, element))
    if (matched.length === 0)
      continue
    const specificity = Math.max(...matched.map(weight))
    for (const [name, value] of rule.declarations) {
      const current = winners.get(name)
      if (!current || specificity >= current.specificity)
        winners.set(name, { specificity, value })
    }
  }
  for (const [name, { value }] of winners)
    target.set(name, value)
}

/**
 * Значения свойств на корне (или на острове) после каскада слоёв в порядке
 * `layers`: более поздний слой побеждает независимо от специфичности, кастомные
 * свойства наследуются островом от корня.
 */
export function cascade(layers: readonly string[], at: CascadeAt = {}): Map<string, string> {
  const attribute = at.attribute ?? 'data-theme'
  const parsed = layers.map(css => parseRules(css, at))
  const compute = (element: Element, inherited: Map<string, string>): Map<string, string> => {
    const out = new Map(inherited)
    for (const rules of parsed)
      applyLayer(out, rules, element, attribute)
    return out
  }
  const root = compute({ root: true, value: at.root }, new Map())
  return at.island === undefined ? root : compute({ root: false, value: at.island }, root)
}
