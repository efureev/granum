import { describe, expect, it } from 'vitest'
import { resolveGranum } from '../core/resolve'
import { planTokenPrune } from '../node/tokenPrune'
import { makeManifest, themeData } from './helpers'

const TOKENS_CSS = [
  ':root {',
  '  --seed: #111;',
  '  --chain-a: var(--chain-b);',
  '  --chain-b: var(--chain-a);',
  '  --lonely: #222;',
  '  --by-pattern: #333;',
  '  --by-app: #444;',
  '  --by-override: #555;',
  '}',
  '',
].join('\n')

const tokensSection = { source: { path: '/x/tokens.css', kind: 'tokens' as const, providerId: 'pkg' }, css: TOKENS_CSS }
const baseSection = { source: { path: '/x/base.css', kind: 'base' as const, providerId: 'pkg' }, css: ':root { --from-base: 4px } body{margin:var(--seed)}' }

const manifest = makeManifest('pkg', {
  A: { safelist: ['bg-[var(--seed)]'], tokens: { consumes: ['--seed'], dynamic: [] } },
  B: { tokens: { consumes: [], dynamic: ['--by-pattern'] } },
}, { theme: { defaultTheme: 'paper', catalog: { paper: { title: 'P', data: 'themes/paper.json', modes: ['light', 'dark'], defaultMode: 'light' } }, declares: [] } })

/** Данные темы — пакетный слой: обрезаются по достижимости (T-14). */
const PAPER = themeData('paper', {
  light: { 'role': 'var(--seed)', 'role-unused': '#999', 'only-light': '#aaa' },
  dark: { 'role': 'var(--seed)', 'role-unused': '#000', 'only-dark': 'var(--lonely)' },
})

function plan(input: Partial<Parameters<typeof planTokenPrune>[0]> & { components?: 'all' | string[], overrides?: Record<string, Record<string, string>>, define?: Record<string, { extends: string, tokens: Record<string, string> }> } = {}): ReturnType<typeof planTokenPrune> {
  const resolution = resolveGranum({
    providers: [manifest],
    components: input.components ?? 'all',
    themeData: { pkg: { paper: PAPER } },
    modes: { names: ['light', 'dark', ...Object.keys(input.define ?? {})], ...(input.overrides ? { tokenOverrides: input.overrides } : {}), ...(input.define ? { define: input.define } : {}) },
  })
  return planTokenPrune({
    resolution,
    options: input.options,
    inlined: input.inlined ?? [tokensSection],
    componentCss: input.componentCss ?? [],
    appConsumes: input.appConsumes ?? [],
    ...(input.engineCss ? { engineCss: input.engineCss } : {}),
  })
}

describe('planTokenPrune: корни', () => {
  it('потребление из манифеста и safelist — корень; никем не потребляемый — removable', () => {
    const p = plan()
    expect(p.kept.get('seed')?.kind).toBe('usage')
    expect(p.removable).toContain('lonely')
  })

  it('var() в правилах инлайнимого base и в CSS компонентов — корни', () => {
    expect(plan({ inlined: [tokensSection, baseSection] }).kept.get('seed')?.kind).toBe('usage')
    expect(plan({ inlined: [tokensSection, baseSection], components: ['pkg:B'] }).kept.get('seed')?.kind).toBe('inlined-rule')
    expect(plan({ components: ['pkg:B'], componentCss: ['.x{color:var(--lonely)}'] }).kept.get('lonely')?.kind).toBe('component-css')
  })

  it('значения приложения — корни: override (root и режим) и режим define', () => {
    expect(plan({ overrides: { light: { 'by-override': '#0f0' } } }).kept.get('by-override')?.kind).toBe('app-value')
    expect(plan({ overrides: { root: { lonely: '#0f0' } } }).kept.get('lonely')?.kind).toBe('app-value')
    expect(plan({ define: { ocean: { extends: 'dark', tokens: { 'by-app': '#0ff' } } } }).kept.get('by-app')?.kind).toBe('app-value')
  })

  it('исходники приложения — корень', () => {
    expect(plan({ appConsumes: ['--by-app'] }).kept.get('by-app')?.kind).toBe('app-source')
  })

  it('вывод движка — утилиты и preflight — корень', () => {
    // Правило держит токен телом декларации, а не именем класса: в `consumes` манифеста его нет.
    expect(plan({ components: ['pkg:B'], engineCss: ['.atom-frame{border:1px solid var(--lonely)}'] }).kept.get('lonely')?.kind).toBe('engine-css')
    expect(plan({ components: ['pkg:B'], engineCss: ['', 'body{color:var(--lonely)}'] }).kept.get('lonely')?.kind).toBe('engine-css')
    expect(plan({ components: ['pkg:B'] }).removable).toContain('lonely')
  })
})

describe('planTokenPrune: dynamic объявляет выбранный компонент', () => {
  it('в селекции держит, с провайдером и компонентом в причине; вне селекции — нет и не мёртв', () => {
    const all = plan()
    expect(all.kept.get('by-pattern')?.kind).toBe('keep-pattern')
    const reason = all.kept.get('by-pattern')
    expect(reason?.kind === 'keep-pattern' && reason.pattern).toContain('pkg:B')
    const onlyA = plan({ components: ['pkg:A'] })
    expect(onlyA.kept.has('by-pattern')).toBe(false)
    expect(onlyA.removable).toContain('by-pattern')
    expect(onlyA.deadPatterns).toEqual([])
  })
})

describe('planTokenPrune: keep и мёртвые шаблоны', () => {
  it('точное имя, звёздочка, RegExp, keepPrefixes', () => {
    expect(plan({ options: { keep: ['lonely'] } }).kept.get('lonely')?.kind).toBe('keep-pattern')
    expect(plan({ options: { keep: ['by-*'] } }).removable).not.toContain('by-pattern')
    expect(plan({ options: { keep: [/^lone/] } }).removable).not.toContain('lonely')
    expect(plan({ options: { keepPrefixes: ['by-'] } }).removable).not.toContain('by-pattern')
    expect(plan({ options: { keep: ['--lonely'] } }).kept.has('lonely')).toBe(true)
  })

  /**
   * С флагом `g` или `y` метод `test` помнит `lastIndex`: после совпадения
   * следующий токен проверяется не с начала, и `/^by-/g` держал бы через раз.
   */
  it('шаблон RegExp с флагами g и y держит каждый совпавший токен и не меняет lastIndex шаблона', () => {
    for (const pattern of [/^by-/g, /^by-/y]) {
      const p = plan({ options: { keep: [pattern] } })
      for (const token of ['by-app', 'by-override', 'by-pattern'])
        expect(p.kept.get(token)?.kind, `${pattern} → ${token}`).toBe('keep-pattern')
      expect(pattern.lastIndex).toBe(0)
    }
  })

  it('несовпавший шаблон — мёртвый; совпавший (даже второй) и целящийся в base — нет', () => {
    expect(plan({ options: { keep: ['xh-typo-*'] } }).deadPatterns).toEqual(['xh-typo-*'])
    expect(plan({ options: { keep: ['lonely', 'lone*'] } }).deadPatterns).toEqual([])
    expect(plan({ options: { keep: ['from-base'] }, inlined: [tokensSection, baseSection] }).deadPatterns).toEqual([])
  })
})

describe('planTokenPrune: замыкание', () => {
  it('взаимная ссылка не зацикливает, referenced-by фиксируется', () => {
    const p = plan({ options: { keep: ['chain-a'] } })
    expect(p.kept.get('chain-b')?.kind).toBe('referenced-by')
  })

  it('данные темы не корень: недостижимый токен темы — removable во всех режимах (T-14, T-15)', () => {
    const p = plan({ components: ['pkg:B'] })
    expect(p.removable).toContain('role-unused')
    expect(p.removable).toContain('only-dark')
    expect(p.kept.has('role')).toBe(false)
    // Достижимый из потребления — держит и то, на что ссылается его значение.
    const used = plan({ components: ['pkg:B'], componentCss: ['.x{color:var(--only-dark)}'] })
    expect(used.kept.get('only-dark')?.kind).toBe('component-css')
    expect(used.kept.get('lonely')?.kind).toBe('referenced-by')
  })
})
