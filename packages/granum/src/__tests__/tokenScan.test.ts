import { describe, expect, it } from 'vitest'
import { extractTokenLiterals, extractTokenUses, scanTokenConsumption, unescapeCss } from '../node/tokenScan'

describe('extractTokenUses', () => {
  it('находит var() где угодно, включая вложенные и арбитражные значения; фиксирует fallback', () => {
    const uses = extractTokenUses('.a{color:var(--fg)} class="bg-[var(--xh-bg)]" var(--a, var(--b, 1px)) var( --sp )')
    expect([...uses.keys()].sort()).toEqual(['a', 'b', 'fg', 'sp', 'xh-bg'])
    expect(uses.get('a')).toBe(true)
    expect(uses.get('b')).toBe(true)
    expect(uses.get('fg')).toBe(false)
  })

  it('fallback запоминается, если есть хоть одно потребление с ним', () => {
    expect(extractTokenUses('var(--x) var(--x, 1)').get('x')).toBe(true)
  })
})

describe('extractTokenLiterals', () => {
  it('имя целиком в кавычках любого вида; строки стилей не считаются', () => {
    const literals = extractTokenLiterals(`el.style.setProperty('--xh-alert-bg', c); const z = "--xh-z-dropdown"; const t = \`--tpl\`; const no = '--x: 8px'; const css = 'border: 1px solid var(--y)'`)
    expect([...literals].sort()).toEqual(['tpl', 'xh-alert-bg', 'xh-z-dropdown'])
  })
})

describe('scanTokenConsumption', () => {
  it('в CSS снимает экранирование и не ищет литералы', () => {
    const r = scanTokenConsumption('.bg-\\[var\\(--xh-bg\\)\\]{background:var(--xh-bg)} .x{content:"--fake"}', 'a.css')
    expect([...r.uses.keys()]).toEqual(['xh-bg'])
    expect(r.literals.size).toBe(0)
    expect(unescapeCss('\\[x\\]')).toBe('[x]')
  })

  it('в JS ищет оба канала', () => {
    const r = scanTokenConsumption(`const v = '--z'; el.style = 'var(--w)'`, 'chunk.js')
    expect([...r.uses.keys()]).toEqual(['w'])
    expect([...r.literals]).toEqual(['z'])
  })
})
