import type { GranumProvider } from '../contract'
import { describe, expect, it, vi } from 'vitest'
import { toProviderNode } from '../core/providerNode'
import { resolveThemes } from '../core/resolveThemes'
import { collectTokenLayers } from '../core/tokenLayers'
import { makeProvider } from './helpers'

function themed(theme: GranumProvider['theme'], components: GranumProvider['components'] = []): ReturnType<typeof resolveThemes> {
  const node = toProviderNode(makeProvider('p', { ...(theme ? { theme } : {}), components }))
  return resolveThemes([node], { names: theme?.tokenDefinitions ? Object.keys(theme.tokenDefinitions) : ['light'] }, node.components)
}

function flatten(result: ReturnType<typeof collectTokenLayers>): Record<string, Record<string, Record<string, string | undefined>>> {
  const out: Record<string, Record<string, Record<string, string | undefined>>> = {}
  for (const [theme, blocks] of result) {
    const perTheme: Record<string, Record<string, string | undefined>> = {}
    for (const block of blocks) {
      const perSelector: Record<string, string | undefined> = {}
      for (const [token, chain] of block.tokens)
        perSelector[token] = chain.effective
      perTheme[block.selector] = perSelector
    }
    out[theme] = perTheme
  }
  return out
}

describe('collectTokenLayers: цепочки слоёв (INV-THM-2)', () => {
  it('провайдер → компонент → app-override, в порядке применения', () => {
    const themes = themed(
      { tokenDefinitions: { light: { selector: ':root', tokens: { brd: '#aaa' } } } },
      [{ name: 'Card', tokenDefinitions: { light: { selector: ':root', tokens: { brd: '#bbb' } } } }],
    )
    const chain = collectTokenLayers(themes, { light: { brd: '#ccc' } }).get('light')![0]!.tokens.get('brd')!
    expect(chain.layers).toEqual([
      { source: 'provider:p', value: '#aaa' },
      { source: 'component:Card', value: '#bbb', componentKey: 'p:Card' },
      { source: 'app-override', value: '#ccc' },
    ])
    expect(chain.effective).toBe('#ccc')
  })

  it('токен без overrides несёт один слой и своё значение', () => {
    const chain = collectTokenLayers(themed({ tokenDefinitions: { light: { tokens: { brd: '#aaa' } } } }), undefined)
      .get('light')![0]!
      .tokens
      .get('brd')!
    expect(chain.layers).toEqual([{ source: 'provider:p', value: '#aaa' }])
    expect(chain.effective).toBe('#aaa')
  })
})

describe('collectTokenLayers: strictTokens (INV-THM-3)', () => {
  const themes = themed({ tokenDefinitions: { light: { selector: ':root', tokens: { brd: '#aaa' } } } })

  it('отброшенный override остаётся в layers с пометкой, но не становится effective', () => {
    const onSkippedOverride = vi.fn()
    const result = collectTokenLayers(themes, { light: { brd: '#ccc', unknown: '#ddd' } }, { strictTokens: true, onSkippedOverride })
    const block = result.get('light')![0]!
    expect(block.tokens.get('brd')!.effective).toBe('#ccc')
    expect(block.tokens.get('unknown')!.effective).toBeUndefined()
    expect(block.tokens.get('unknown')!.layers).toEqual([{ source: 'app-override', value: '#ddd', skipped: 'strict-tokens' }])
    expect(onSkippedOverride).toHaveBeenCalledExactlyOnceWith('light', 'unknown')
  })

  it('без strictTokens неизвестный override пишется как есть', () => {
    const chain = collectTokenLayers(themes, { light: { unknown: '#ddd' } }).get('light')![0]!.tokens.get('unknown')!
    expect(chain.effective).toBe('#ddd')
    expect(chain.layers[0]!.skipped).toBeUndefined()
  })

  it('known — имена по всей теме, поверх всех селекторов', () => {
    const dark = themed({ tokenDefinitions: { dark: { selector: '.dark', tokens: { brd: '#111' } } } })
    const result = collectTokenLayers(dark, { dark: { '[data-theme="dark"]': { brd: '#222' } } }, { strictTokens: true })
    const target = result.get('dark')!.find(b => b.selector === '[data-theme="dark"]')!
    expect(target.tokens.get('brd')!.effective).toBe('#222')
    expect(target.tokens.get('brd')!.layers.at(-1)!.skipped).toBeUndefined()
  })
})

describe('collectTokenLayers: раскладка по селекторам', () => {
  it('вложенная форма занимает место в порядке даже при отброшенных токенах', () => {
    const themes = themed({ tokenDefinitions: { light: { selector: ':root', tokens: { brd: '#aaa' } } } })
    const result = collectTokenLayers(themes, { light: { '.a': { nope: '1' }, '.b': { brd: '#222' } } }, { strictTokens: true })
    expect(result.get('light')!.map(b => b.selector)).toEqual([':root', '.a', '.b'])
    expect(result.get('light')![1]!.tokens.get('nope')!.effective).toBeUndefined()
  })

  it('плоский override уходит в первичный селектор темы, а не в :root', () => {
    const themes = themed({ tokenDefinitions: { dark: { selector: '.dark', tokens: { brd: '#111' } } } })
    const result = collectTokenLayers(themes, { dark: { brd: '#222' } })
    expect(result.get('dark')!.map(b => b.selector)).toEqual(['.dark'])
    expect(result.get('dark')![0]!.tokens.get('brd')!.effective).toBe('#222')
  })

  it('тема без вкладов: с overrides попадает в результат, без — пропускается', () => {
    const empty = themed({})
    expect(flatten(collectTokenLayers(empty, { light: { brd: '#222' } }))).toEqual({ light: { ':root': { brd: '#222' } } })
    expect(collectTokenLayers(empty, undefined).has('light')).toBe(false)
  })

  it('мультиселекторная тема сохраняет оба блока в порядке появления', () => {
    const a = toProviderNode(makeProvider('a', { theme: { tokenDefinitions: { dark: { selector: '.dark', tokens: { x: '1' } } } } }))
    const b = toProviderNode(makeProvider('b', { theme: { tokenDefinitions: { dark: { selector: '[data-theme="dark"]', tokens: { y: '2' } } } } }))
    expect(flatten(collectTokenLayers(resolveThemes([a, b], { names: ['dark'] }), undefined)))
      .toEqual({ dark: { '.dark': { x: '1' }, '[data-theme="dark"]': { y: '2' } } })
  })

  it('значение, унаследованное через extends, материализовало приложение: слой app-theme', () => {
    // Вклад провайдера записан в тему `light`; в теме `e` его нет ни в одном
    // item — значение принесло определение приложения, и провенанс честно
    // говорит `app-theme`, а не приписывает его провайдеру.
    const node = toProviderNode(makeProvider('p', { theme: { tokenDefinitions: { light: { tokens: { bg: '#fff' } } } } }))
    const themes = resolveThemes([node], { names: ['e'], define: { e: { extends: 'light', tokens: { fg: '#000' } } } })
    const block = collectTokenLayers(themes, undefined).get('e')![0]!
    expect(block.selector).toBe('[data-theme="e"]')
    expect(block.tokens.get('bg')!.layers).toEqual([{ source: 'app-theme', value: '#fff' }])
    expect(block.tokens.get('fg')!.layers).toEqual([{ source: 'app-theme', value: '#000' }])
  })
})
