import {
  accessibilityRules,
  animationPreflights,
  animationRules,
  colorOpacityRules,
  filterRules,
  numericPreflights,
  numericRules,
  objectRules,
  spacingRules,
  spacingVariants,
  typographyRules,
} from '@feugene/unocss-mini-extra-rules'
import { createGenerator, presetMini } from 'unocss'
import { describe, expect, it } from 'vitest'
import { createEngine } from '../builtin'
import { GOLDEN_CLASSES } from './fixtures/classes'

/**
 * Golden-тест (E-5, INV-ENG-4): встроенный движок обязан давать тот же CSS,
 * что `unocss@66.7.5` + `presetMini` + `@feugene/unocss-mini-extra-rules@0.8.1`
 * в конфигурации пресета v1. Эталон живой (из devDependencies) и одновременно
 * зафиксирован файловым снапшотом — обновляется только руками.
 */
async function reference(classes: Iterable<string>, variablePrefix?: string): Promise<{ css: string, matched: Set<string> }> {
  const uno = await createGenerator({
    presets: [presetMini(variablePrefix ? { variablePrefix } : {})],
    rules: [
      ...accessibilityRules,
      ...animationRules,
      ...colorOpacityRules,
      ...filterRules,
      ...numericRules,
      ...objectRules,
      ...spacingRules,
      ...typographyRules,
    ],
    variants: [...spacingVariants],
    preflights: [...animationPreflights, ...numericPreflights],
  })
  const result = await uno.generate(new Set([...classes].sort()), { preflights: true, safelist: false, minify: false })
  return { css: result.css, matched: result.matched }
}

describe('golden: встроенный движок против unocss 66.7.5', () => {
  it('css и множество matched совпадают на эталонном наборе классов', async () => {
    const ref = await reference(GOLDEN_CLASSES)
    const out = await createEngine().generate({ classes: new Set(GOLDEN_CLASSES) })
    expect(out.css).toBe(ref.css)
    expect(new Set(out.matched.keys())).toEqual(ref.matched)
    await expect(out.css).toMatchFileSnapshot('./__snapshots__/golden.css')
  })

  it('совпадают и с variablePrefix', async () => {
    const ref = await reference(GOLDEN_CLASSES, 'ds-')
    const out = await createEngine({ variablePrefix: 'ds-' }).generate({ classes: new Set(GOLDEN_CLASSES) })
    expect(out.css).toBe(ref.css)
  })
})
