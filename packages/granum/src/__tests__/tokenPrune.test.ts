import { describe, expect, it } from 'vitest'
import { resolveGranum } from '../core/resolve'
import { planTokenPrune } from '../node/tokenPrune'
import { makeManifest, makeProvider } from './helpers'

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
  A: { safelist: ['bg-[var(--seed)]'], tokens: { declares: {}, consumes: ['--seed'], dynamic: [] } },
  B: { tokens: { declares: {}, consumes: [], dynamic: ['--by-pattern'] } },
})

function plan(input: Partial<Parameters<typeof planTokenPrune>[0]> & { components?: 'all' | string[] } = {}): ReturnType<typeof planTokenPrune> {
  const resolution = resolveGranum({ providers: [manifest], components: input.components ?? 'all', ...(input.tokenOverrides ? { themes: { tokenOverrides: input.tokenOverrides } } : {}) })
  return planTokenPrune({
    resolution,
    options: input.options,
    tokenOverrides: input.tokenOverrides,
    inlined: input.inlined ?? [tokensSection],
    componentCss: input.componentCss ?? [],
    appConsumes: input.appConsumes ?? [],
  })
}

describe('planTokenPrune: корни (INV-TOK-2)', () => {
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

  it('ключи tokenOverrides в обеих формах — корни', () => {
    expect(plan({ tokenOverrides: { light: { 'by-override': '#0f0' } } }).kept.get('by-override')?.kind).toBe('override')
    expect(plan({ tokenOverrides: { light: { '.dark': { 'by-override': '#0f0' } } } }).kept.has('by-override')).toBe(true)
  })

  it('исходники приложения — корень', () => {
    expect(plan({ appConsumes: ['--by-app'] }).kept.get('by-app')?.kind).toBe('app-source')
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

  it('несовпавший шаблон — мёртвый; совпавший (даже второй) и целящийся в base — нет', () => {
    expect(plan({ options: { keep: ['xh-typo-*'] } }).deadPatterns).toEqual(['xh-typo-*'])
    expect(plan({ options: { keep: ['lonely', 'lone*'] } }).deadPatterns).toEqual([])
    expect(plan({ options: { keep: ['from-base'] }, inlined: [tokensSection, baseSection] }).deadPatterns).toEqual([])
  })
})

describe('planTokenPrune: замыкание (INV-TOK-3)', () => {
  it('взаимная ссылка не зацикливает, referenced-by фиксируется', () => {
    const p = plan({ options: { keep: ['chain-a'] } })
    expect(p.kept.get('chain-b')?.kind).toBe('referenced-by')
  })

  it('структурные слои дают корни и значения для замыкания', () => {
    const structural = makeProvider('s', { theme: { tokenDefinitions: { light: { tokens: { role: 'var(--seed)' } } } } })
    const resolution = resolveGranum({ providers: [structural, manifest], components: ['pkg:B'] })
    const p = planTokenPrune({ resolution, options: undefined, tokenOverrides: undefined, inlined: [tokensSection], componentCss: [], appConsumes: [] })
    expect(p.kept.get('role')?.kind).toBe('structural')
    expect(p.kept.get('seed')?.kind).toBe('referenced-by')
  })
})
