import { describe, expect, it } from 'vitest'
import { expandApply, hasApply } from '../build/apply'
import { ApplyExpansionError } from '../core/errors'
import { createEngine } from '../engine/builtin'

const engine = createEngine()

describe('expandApply (B-11, ADR-3)', () => {
  it('раскрывает @apply в плоском правиле декларациями движка', async () => {
    const css = '.x-sp-test {\n  display: flex;\n  @apply text-lg font-bold;\n}\n'
    const out = await expandApply(css, engine, 'styles.css')
    expect(out).toBe('.x-sp-test {\n  display: flex;\n  font-size:1.125rem;line-height:1.75rem;font-weight:700;\n}\n')
    expect(hasApply(out)).toBe(false)
  })

  it('директива внутри комментария не директива', async () => {
    const css = '.a{color:red}\n/* .b { @apply text-lg; } */\n'
    expect(hasApply(css)).toBe(false)
    expect(await expandApply(css, engine, 'a.css')).toBe(css)
  })

  it('без @apply текст не меняется', async () => {
    expect(await expandApply('.a{color:red}', engine, 'a.css')).toBe('.a{color:red}')
  })

  it('класс без правила — ошибка, а не молчание', async () => {
    await expect(expandApply('.a{@apply nonsense-utility;}', engine, 'a.css')).rejects.toThrow(ApplyExpansionError)
    await expect(expandApply('.a{@apply nonsense-utility;}', engine, 'a.css')).rejects.toMatchObject({ reason: 'unmatched-class' })
  })

  it('вариант или вложенный контекст — ошибка', async () => {
    await expect(expandApply('.a{@apply hover:p-4;}', engine, 'a.css')).rejects.toMatchObject({ reason: 'non-flat-rule' })
    await expect(expandApply('@media (x){.a{@apply p-4;}}', engine, 'a.css')).rejects.toMatchObject({ reason: 'nested-context' })
  })
})
