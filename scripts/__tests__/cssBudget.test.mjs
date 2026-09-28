import { describe, expect, it } from 'vitest'
import { classifyAsset, classifyClassEvidence, cssClassesOf, cssLayerBody, declaredTokens, htmlClassTokens, reachableTokens, referencedTokens, strictCheck, whitespaceTokens } from '../lib/cssBudget.mjs'

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

  it('тело слоя и классы слоя: субъект правила, снятое экранирование, без значений', () => {
    const css = '@layer granum.components{.xxx-card{padding:1.5rem}.dark .xxx-card__title{color:#fff}}@layer granum.utilities{.p-4{padding:1rem}.bg-\\[var\\(--x\\)\\]{background:var(--x)}@media (min-width:40rem){.sm\\:flex{display:flex}}}'

    // `1.5rem` классом не становится, `.dark` — область темы, а не класс
    // компонента: считается правый compound.
    expect([...cssClassesOf(cssLayerBody(css, 'components'))].sort()).toEqual(['xxx-card', 'xxx-card__title'])
    // Внутри @media правила тоже читаются, а сама директива классом не становится.
    expect([...cssClassesOf(cssLayerBody(css, 'utilities'))].sort()).toEqual(['bg-[var(--x)]', 'p-4', 'sm:flex'])
    expect(cssLayerBody(css, 'themes')).toBe('')
  })

  it('лестница доказательств: целый токен доказывает, префикс — нет', () => {
    const jsText = ' p-  flex  xxx-card '
    const context = {
      htmlClasses: htmlClassTokens('<div class="mx-auto p-6"></div>'),
      jsTokens: whitespaceTokens(jsText),
      jsText,
      structuralClasses: new Set(['xxx-card']),
    }

    expect(classifyClassEvidence('p-6', context)).toEqual({ evidence: ['html'], proven: true })
    expect(classifyClassEvidence('flex', context)).toEqual({ evidence: ['js-literal'], proven: true })
    // Собственный CSS компонента объясняет класс, но не доказывает его использование.
    expect(classifyClassEvidence('xxx-card', context)).toEqual({ evidence: ['js-literal', 'component-css'], proven: true })
    // Собран конкатенацией: в бандле лишь префикс `p-`, и это не доказательство.
    expect(classifyClassEvidence('p-2', context)).toEqual({ evidence: ['js-fragment'], proven: false })
    expect(classifyClassEvidence('rounded', context)).toEqual({ evidence: [], proven: false })
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

    // Недоказанные классы — списком, а не числом: исчезнувший ожидаемый тоже расхождение.
    const withClasses = { ...report, classes: { unproven: ['p-2', 'p-3'] } }
    expect(strictCheck({ classes: { unproven: ['p-2', 'p-3'] } }, withClasses).find(c => c.name === 'classes.unproven')?.ok).toBe(true)
    expect(strictCheck({ classes: { unproven: ['p-2'] } }, withClasses).find(c => c.name === 'classes.unproven')?.ok).toBe(false)
    expect(strictCheck({ classes: { unproven: ['p-2', 'p-3', 'p-4'] } }, withClasses).find(c => c.name === 'classes.unproven')?.ok).toBe(false)
  })
})
