import presetWind3 from '@unocss/preset-wind3'
import { createGenerator } from 'unocss'
import { describe, expect, it } from 'vitest'
import { windEngine } from '../wind'
import { GOLDEN_CLASSES } from './fixtures/classes'

/**
 * Golden-тест (E-5, INV-ENG-4): вендоренный форк обязан давать тот же CSS, что
 * живой `unocss@66.7.5` + `presetWind3`. Эталон берётся из devDependencies и
 * одновременно фиксируется файловым снапшотом — тот обновляется только руками.
 *
 * Сверяется **чистый** форк (`extraRules: false`): в эталоне нет ни одной нашей
 * строки, иначе тест сравнивал бы наш код с нашим же. Доп-правило проверяется
 * отдельно — `rules/extra/__tests__/colorOpacity.test.ts` и `engine.test.ts`.
 *
 * Preflight и утилиты сверяются по отдельности: движок отдаёт их разными полями
 * (E-15), и склейка скрыла бы ошибку в делении.
 */
const BASE_LAYERS = ['preflights', 'properties']

async function reference(classes: Iterable<string>, variablePrefix?: string): Promise<{
  preflight: string
  utilities: string
  matched: Set<string>
}> {
  const uno = await createGenerator({
    presets: [presetWind3(variablePrefix ? { variablePrefix } : {})],
  })
  const result = await uno.generate(new Set([...classes].sort()), { preflights: true, safelist: false, minify: false })
  return {
    preflight: result.getLayers(BASE_LAYERS).trim(),
    utilities: result.getLayers(undefined, BASE_LAYERS),
    matched: result.matched,
  }
}

describe('golden: вендоренный форк против unocss 66.7.5 + presetWind3', () => {
  it('утилиты, preflight и множество matched совпадают на эталонном наборе', async () => {
    const ref = await reference(GOLDEN_CLASSES)
    const out = await windEngine({ extraRules: false }).generate({ classes: new Set(GOLDEN_CLASSES) })
    expect(out.css).toBe(ref.utilities)
    expect(out.preflight).toBe(ref.preflight)
    expect(new Set(out.matched.keys())).toEqual(ref.matched)
    await expect(out.css).toMatchFileSnapshot('./__snapshots__/golden.css')
    await expect(out.preflight).toMatchFileSnapshot('./__snapshots__/golden-preflight.css')
  })

  it('совпадают и с variablePrefix', async () => {
    const ref = await reference(GOLDEN_CLASSES, 'ds-')
    const out = await windEngine({ extraRules: false, variablePrefix: 'ds-' }).generate({ classes: new Set(GOLDEN_CLASSES) })
    expect(out.css).toBe(ref.utilities)
    expect(out.preflight).toBe(ref.preflight)
  })

  /**
   * То, ради чего движок переехал с preset-mini: четыре семейства, которых в mini
   * не было ни в одном виде, из-за чего класс в разметке оставался без CSS, а
   * ошибки при этом не возникало.
   */
  it('wind-утилиты, которых не знал preset-mini, имеют правила', async () => {
    const out = await windEngine().generate({
      classes: new Set(['border-collapse', 'list-none', 'touch-none', 'scroll-py-1', 'table-fixed']),
    })
    expect(out.unmatched).toEqual([])
    expect(out.css).toContain('.border-collapse{border-collapse:collapse;}')
    expect(out.css).toContain('.list-none{list-style-type:none;}')
    expect(out.css).toContain('.touch-none{touch-action:none;}')
    expect(out.css).toContain('.table-fixed{table-layout:fixed;}')
    expect(out.css).toContain('scroll-padding-top:0.25rem')
  })
})
