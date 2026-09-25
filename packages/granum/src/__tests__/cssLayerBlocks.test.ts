import { describe, expect, it } from 'vitest'
import { extractLayerBlocks } from '../node/cssLayerBlocks'
import { bundleLayerSizes } from '../node/report'

const MINIFIED = '@layer granum.tokens,granum.base;@layer granum.themes{:root{--a:"}"}@supports not (x:y){:root{--b:1}}}@layer other{.x{y:1}}@layer granum.components{.card{padding:1rem}}@layer granum.utilities{.p-4{padding:1rem}}@layer granum.utilities{.flex{display:flex}}.app{color:red}'

describe('extractLayerBlocks (A-19)', () => {
  it('собирает блоки своего префикса, склеивает повторы, чужой слой и нелейерный CSS не берёт', () => {
    const { blocks, statements } = extractLayerBlocks(MINIFIED, 'granum')
    expect(statements).toEqual(['@layer granum.tokens,granum.base;'])
    expect([...blocks.keys()]).toEqual(['themes', 'components', 'utilities'])
    // Скобка в строке и вложенный @supports не ломают границы блока.
    expect(blocks.get('themes')).toBe('@layer granum.themes{:root{--a:"}"}@supports not (x:y){:root{--b:1}}}')
    expect(blocks.get('utilities')).toBe('@layer granum.utilities{.p-4{padding:1rem}}@layer granum.utilities{.flex{display:flex}}')
    expect([...blocks.values()].join('')).not.toContain('.app{')
    expect([...blocks.values()].join('')).not.toContain('other')
  })

  it('bundleLayerSizes: пустые слои — нули, total включает объявление порядка; без блоков — undefined', () => {
    const sizes = bundleLayerSizes(MINIFIED, 'granum')!
    expect(sizes.tokens.raw).toBe(0)
    expect(sizes.base.raw).toBe(0)
    expect(sizes.components.raw).toBe('@layer granum.components{.card{padding:1rem}}'.length)
    expect(sizes.total.raw).toBe('@layer granum.tokens,granum.base;'.length + sizes.themes.raw + sizes.components.raw + sizes.utilities.raw)
    expect(bundleLayerSizes('.a{b:c}', 'granum')).toBeUndefined()
    expect(bundleLayerSizes(MINIFIED, 'ds')).toBeUndefined()
  })
})
