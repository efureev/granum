import { describe, expect, it } from 'vitest'
import { collectCssRules, diffCssRules, normalizeDeclarations } from '../lib/cssRules.mjs'

describe('cssRules', () => {
  it('снимает @layer, держит @media/@supports в контексте, @keyframes — одно правило', () => {
    const rules = collectCssRules('@layer a,b;@layer a{.x{color:red;margin:0}}@media (min-width:1px){.y{gap:1px}}@supports not (a:b){:root{--t:1}}@keyframes k{to{x:1}}')
    expect([...rules.keys()]).toEqual(['|.x', '@media (min-width:1px)|.y', '@supports not (a:b)|:root', '|@keyframes k'])
    expect(rules.get('|.x')).toEqual(['color:red', 'margin:0'])
  })

  it('порядок объявлений и селекторов в списке не важен; ; внутри url() не режет', () => {
    expect(normalizeDeclarations('b:url(data:x;base64,zz);a:1')).toEqual(['a:1', 'b:url(data:x;base64,zz)'])
    const a = collectCssRules('.a,.b{x:1;y:2}')
    const b = collectCssRules('.b{y:2;x:1}.a{y:2;x:1}')
    expect(diffCssRules(a, b)).toEqual({ onlyLeft: [], onlyRight: [], changed: [] })
  })

  it('diff называет только-слева, только-справа и разные объявления', () => {
    const d = diffCssRules(collectCssRules('.a{x:1}.b{x:1}'), collectCssRules('.b{x:2}.c{x:1}'))
    expect(d.onlyLeft).toEqual(['|.a'])
    expect(d.onlyRight).toEqual(['|.c'])
    expect(d.changed).toEqual([{ key: '|.b', left: ['x:1'], right: ['x:2'] }])
  })
})
