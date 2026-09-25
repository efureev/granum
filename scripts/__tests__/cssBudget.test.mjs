import { describe, expect, it } from 'vitest'
import { classifyAsset, declaredTokens, reachableTokens, referencedTokens, strictCheck } from '../lib/cssBudget.mjs'

describe('cssBudget', () => {
  it('классифицирует ассеты стендов и не знает лишних', () => {
    expect(classifyAsset('vue-abc.js')).toBe('vue')
    expect(classifyAsset('hpkg-abc.js')).toBe('pkg')
    expect(classifyAsset('hpkg-abc.css')).toBe('pkg')
    expect(classifyAsset('index-abc.css')).toBe('css')
    expect(classifyAsset('index-abc.js')).toBe('entry')
    expect(classifyAsset('other-abc.js')).toBeUndefined()
  })

  it('объявления — включая блоки внутри @supports; ссылки — var() и литералы в JS', () => {
    const css = ':root{--a:1px;--b:var(--a)}@supports not (x:y){:root{--c:2}}.x{margin:var(--b)}/* --z:1 */'
    expect([...declaredTokens(css)].sort()).toEqual(['a', 'b', 'c'])
    expect([...referencedTokens(css, 'el.style.getPropertyValue("--d")')].sort()).toEqual(['a', 'b', 'd'])
  })

  it('достижимость идёт от корней вне значений и по значениям объявлений', () => {
    const css = ':root{--a:1px;--b:var(--a);--c:3;--d:var(--c)}.x{margin:var(--b)}'
    const reachable = reachableTokens(css, '')
    expect([...reachable].sort()).toEqual(['a', 'b'])
    // `--c` нужен только `--d`, а `--d` — никому: оба мёртвый груз.
    expect(reachable.has('c')).toBe(false)
    expect([...reachableTokens(css, 'getPropertyValue("--d")')].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('strictCheck сверяет в обе стороны', () => {
    const report = { roles: { vue: {}, entry: {} }, granum: null, tokens: { unused: ['x'], declared: 3 } }
    const checks = strictCheck({ assets: { roles: ['vue', 'entry'] }, report: false, tokens: { maxUnused: 0 } }, report)
    expect(checks.map(c => `${c.name}:${c.ok}`)).toEqual(['assets.roles:true', 'report.absent:true', 'tokens.maxUnused:false'])
    const withGranum = { ...report, granum: { unmatched: ['dead'], undefinedTokens: [], prune: { mode: 'on' } }, engineInBundle: false }
    const c2 = strictCheck({ granum: { unmatched: [], pruneMode: 'on', noEngineInBundle: true } }, withGranum)
    expect(c2.find(c => c.name === 'granum.unmatched')?.ok).toBe(false)
    expect(c2.find(c => c.name === 'granum.pruneMode')?.ok).toBe(true)
    expect(c2.find(c => c.name === 'granum.noEngineInBundle')?.ok).toBe(true)
  })
})
