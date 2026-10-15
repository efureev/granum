import { describe, expect, it } from 'vitest'
import { expandApply, hasApply } from '../build/apply'
import { ApplyExpansionError } from '../core/errors'
import { testEngine } from './testEngine'

const engine = testEngine()

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

/** Вывод wind, снятый с настоящего движка: комментарий слоя перед правилами, варианты под at-rule. */
const atRules = testEngine({
  raw: {
    'w-bold': '/* layer: default */\n.w-bold{font-weight:700;}',
    'md:flex': '/* layer: default */\n@media (min-width: 768px){\n.md\\:flex{display:flex;}\n}',
    'print:hidden': '/* layer: default */\n@media print{\n.print\\:hidden{display:none;}\n}',
    'container': '/* layer: shortcuts */\n.container{width:100%;}\n@media (min-width: 640px){\n.container{max-width:640px;}\n}',
  },
})

describe('expandApply: вариант через at-rule и класс из нескольких правил — ошибка (B-11)', () => {
  it('комментарий слоя перед плоским правилом ему не мешает', async () => {
    expect(await expandApply('.x{@apply w-bold;}', atRules, 'a.css')).toBe('.x{font-weight:700;}')
  })

  it('md: и print: кладут правило под @media — раскрыть его безусловно нельзя', async () => {
    await expect(expandApply('.x{@apply md:flex;}', atRules, 'a.css')).rejects.toMatchObject({ reason: 'non-flat-rule', detail: expect.stringContaining('under \'@media (min-width: 768px)\'') })
    await expect(expandApply('.x{@apply print:hidden;}', atRules, 'a.css')).rejects.toMatchObject({ reason: 'non-flat-rule' })
  })

  it('container — плоское правило и блоки @media: первое правило не весь класс', async () => {
    await expect(expandApply('.x{@apply container;}', atRules, 'a.css')).rejects.toMatchObject({ reason: 'non-flat-rule', detail: expect.stringContaining('2 rules') })
  })
})

describe('expandApply: директива без `;`', () => {
  it('последняя в правиле раскрывается, а не уезжает в dist', async () => {
    expect(hasApply('.x{color:red;@apply font-bold}')).toBe(true)
    expect(await expandApply('.x{color:red;@apply font-bold}', engine, 'a.css')).toBe('.x{color:red;font-weight:700;}')
    expect(await expandApply('.x {\n  @apply font-bold\n}\n', engine, 'a.css')).toBe('.x {\n  font-weight:700;\n}\n')
  })

  it('блочная форма — ошибка', async () => {
    await expect(expandApply('.x{@apply font-bold {}}', engine, 'a.css')).rejects.toMatchObject({ reason: 'nested-context' })
  })
})
