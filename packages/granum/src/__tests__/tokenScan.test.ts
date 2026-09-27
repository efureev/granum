import { describe, expect, it } from 'vitest'
import { extractRequiredTokenUses, extractTokenAssignments, extractTokenLiterals, extractTokenUses, scanTokenConsumption, unescapeCss } from '../node/tokenScan'

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

describe('extractRequiredTokenUses (T-5, INV-DIAG-4)', () => {
  it('в набор попадает только потребление без fallback', () => {
    const required = extractRequiredTokenUses('color:var(--fg); background:var(--bg, white); border-color:var(--brd,var(--fg))')
    expect([...required].sort()).toEqual(['fg'])
  })

  it('один и тот же токен, потреблённый и так и так, требованием остаётся', () => {
    expect([...extractRequiredTokenUses('var(--x, 1) var(--x)')]).toEqual(['x'])
  })

  /**
   * Имя, собранное в рантайме, токеном не является: у `var(--gr-${tone}-text)`
   * префикс `--gr-` объявить некому, и находка на нём была бы вечной. Про такие
   * имена компонент объявляет `dynamicTokens`.
   */
  it('составное имя не даёт фантомного токена-префикса', () => {
    /*
     * Входные данные здесь — исходный текст чанка, в котором ЕСТЬ шаблонный
     * литерал. `${…}` внутри обычной строки для линтера подозрителен, а для
     * этого теста обязателен: сканер разбирает именно такой текст.
     */
    /* eslint-disable no-template-curly-in-string */
    expect([...extractRequiredTokenUses('`var(--gr-${tone}-text)`')]).toEqual([])
    expect([...extractRequiredTokenUses(`'var(--gr-' + tone + '-text)'`)]).toEqual([])
    expect([...extractTokenUses('`var(--gr-${tone}-text)`').keys()]).toEqual([])
    // Настоящее имя рядом с составным по-прежнему видно.
    expect([...extractRequiredTokenUses('`var(--gr-${t}-text)` var(--gr-fg)')]).toEqual(['gr-fg'])
    /* eslint-enable no-template-curly-in-string */
  })
})

describe('extractTokenAssignments (T-5)', () => {
  it('находит присваивание в CSS, ключом объекта и утилитой с произвольным значением', () => {
    const found = extractTokenAssignments(`.a{--own:1px;color:var(--other)} const s = { '--key': v, "--key2": v }; class="[--util:2px]"`)
    expect([...found].sort()).toEqual(['key', 'key2', 'own', 'util'])
  })

  it('потребление присваиванием не считается', () => {
    expect([...extractTokenAssignments('color:var(--fg)')]).toEqual([])
  })
})

describe('scanTokenConsumption: комментарии', () => {
  /**
   * Документация про токен — не потребление токена. Экстрактор классов
   * комментарии срезал всегда (INV-ENG-5), сканер токенов до этого читал их, и
   * JSDoc вида ``var(--gr-z-*)`` давал фантомный токен.
   */
  it('jSDoc и строчный комментарий не дают токенов', () => {
    const code = [
      '/** Слой берётся как var(--gr-z-doc) — только в документации. */',
      '// var(--gr-line-doc) в строчном комментарии',
      'const real = "var(--gr-real)"',
    ].join('\n')
    const r = scanTokenConsumption(code, 'chunk.js')
    expect([...r.uses.keys()]).toEqual(['gr-real'])
    expect([...r.required]).toEqual(['gr-real'])
  })

  it('комментарий CSS тоже не объявляет токен', () => {
    const r = scanTokenConsumption('/* --doc-only: 1px */ .a{--own:2px}', 'a.css')
    expect([...r.assigns]).toEqual(['own'])
  })
})
