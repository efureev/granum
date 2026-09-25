import type { GranumRule } from '../types'
import { describe, expect, it } from 'vitest'
import { createEngine } from '../builtin'
import { extractClasses, stripComments } from '../extract'
import { GOLDEN_CLASSES } from './fixtures/classes'

const engine = createEngine()

describe('createEngine: контракт вывода (INV-ENG-1, INV-ENG-2)', () => {
  it('каждый класс входа либо в matched, либо в unmatched; объединение равно входу', async () => {
    const out = await engine.generate({ classes: new Set(GOLDEN_CLASSES) })
    const all = new Set([...out.matched.keys(), ...out.unmatched])
    expect(all).toEqual(new Set(GOLDEN_CLASSES))
    // `tracking-tightest`: в шкале letterSpacing preset-mini нет `tightest` —
    // класс из фикстуры v1 не давал CSS и там; движок честно это показывает.
    expect(out.unmatched).toEqual(['nonsense-utility', 'shadow-legacy', 'tracking-tightest', 'x-sp-test', 'xh-panel'])
  })

  it('вывод не зависит от порядка входа и одинаков между вызовами', async () => {
    const a = await engine.generate({ classes: new Set(GOLDEN_CLASSES) })
    const b = await engine.generate({ classes: new Set([...GOLDEN_CLASSES].reverse()) })
    const c = await createEngine().generate({ classes: new Set(GOLDEN_CLASSES) })
    expect(b.css).toBe(a.css)
    expect(c.css).toBe(a.css)
    expect([...b.matched.keys()]).toEqual([...a.matched.keys()])
  })

  it('matched несёт правило, селектор, источник и слой', async () => {
    const out = await engine.generate({ classes: new Set(['p-4', 'uppercase', 'hover:bg-red']) })
    expect(out.matched.get('uppercase')).toEqual({ rule: 'uppercase', selector: '.uppercase', source: 'builtin', layer: 'default' })
    const p4 = out.matched.get('p-4')!
    expect(p4.source).toBe('builtin')
    expect(p4.selector).toBe('.p-4')
    expect(p4.rule).toMatch(/\^/)
    expect(out.matched.get('hover:bg-red')!.selector).toBe('.hover\\:bg-red:hover')
    expect(out.css).toContain('.p-4{padding:1rem;}')
    expect(out.css).toContain('.uppercase{text-transform:uppercase;}')
  })

  it('preflight встроенного пресета и доп-правил присутствует; отключается опцией', async () => {
    const withPreflight = await engine.generate({ classes: new Set(['animate-spin', 'tabular-nums']) })
    expect(withPreflight.css).toContain('--un-rotate:0')
    expect(withPreflight.css).toContain('@keyframes granularity-spin')
    expect(withPreflight.css).toContain('--un-numeric-spacing')
    const bare = await createEngine({ preflight: false }).generate({ classes: new Set(['p-4']) })
    expect(bare.css).not.toContain('--un-rotate:0')
    expect(bare.css).toContain('.p-4{padding:1rem;}')
  })
})

describe('createEngine: правила провайдеров и приложения (E-3, INV-ENG-3)', () => {
  it('правило с тем же именем, добавленное позже, перекрывает встроенное и помечается источником', async () => {
    const override: GranumRule = ['uppercase', { 'text-transform': 'uppercase', 'letter-spacing': '0.1em' }]
    const own: GranumRule = [/^tone-(\w+)$/, ([, tone]) => ({ '--tone': tone })]
    const sources = new Map<GranumRule, string>([[override, '@x/heavy']])
    const out = await engine.generate({ classes: new Set(['uppercase', 'tone-warm']), rules: [override, own], sources })
    expect(out.matched.get('uppercase')).toMatchObject({ source: '@x/heavy' })
    expect(out.matched.get('tone-warm')).toMatchObject({ source: 'app', rule: '^tone-(\\w+)$' })
    expect(out.css).toContain('letter-spacing:0.1em')
    expect(out.css).toContain('.tone-warm{--tone:warm;}')
  })

  it('preflights приложения и переопределение шкалы темы', async () => {
    const out = await engine.generate({
      classes: new Set(['p-huge']),
      theme: { spacing: { huge: '99rem' } },
      preflights: [{ css: ':root{--app:1}' }, { css: ({ theme }) => `:root{--huge:${(theme.spacing as Record<string, string>).huge}}` }],
    })
    expect(out.css).toContain('.p-huge{padding:99rem;}')
    expect(out.css).toContain(':root{--app:1}')
    expect(out.css).toContain(':root{--huge:99rem}')
  })

  it('variablePrefix переименовывает переменные и во встроенных preflights', async () => {
    const out = await createEngine({ variablePrefix: 'ds-' }).generate({ classes: new Set(['tabular-nums']) })
    expect(out.css).toContain('--ds-numeric-spacing')
    expect(out.css).not.toContain('--un-numeric-spacing')
  })

  it('extraRules: false — доп-правила не подключаются', async () => {
    const out = await createEngine({ extraRules: false }).generate({ classes: new Set(['uppercase', 'p-4']) })
    expect(out.unmatched).toEqual(['uppercase'])
  })

  it('общие кортежи правил не портятся между генераторами', async () => {
    const a = await createEngine().generate({ classes: new Set(['uppercase', 'sr-only']) })
    const b = await createEngine({ extraRules: false }).generate({ classes: new Set(['p-4']) })
    const c = await createEngine().generate({ classes: new Set(['uppercase', 'sr-only']) })
    expect(b.unmatched).toEqual([])
    expect(c.css).toBe(a.css)
  })
})

describe('extract (E-6, INV-ENG-5)', () => {
  it('извлекает классы из разметки, строк и шаблонных литералов', () => {
    const code = `<template><div class="p-4 hover:bg-red bg-[var(--x)]" :class="ok ? 'border-red' : 'border-green'"></div></template>
<script setup>const cls = \`rounded-[var(--r,4px)] \${x}\`; const s = 'space-x-4 object-[50%_20%]'</script>`
    const set = extractClasses(code, '/x/A.vue')
    for (const c of ['p-4', 'hover:bg-red', 'bg-[var(--x)]', 'border-red', 'border-green', 'rounded-[var(--r,4px)]', 'space-x-4', 'object-[50%_20%]'])
      expect(set, c).toContain(c)
  })

  it('не извлекает из комментариев SFC, блочных и строчных комментариев', () => {
    const code = `<template>
  <!-- класс p-9 здесь только в комментарии -->
  <div class="p-1"></div>
</template>
<script>
/* mt-9 внутри блока */
// ml-9 в строке
const url = 'https://example.test/mr-9' // хвостовой комментарий не режется
</script>`
    const set = extractClasses(code, '/x/B.vue')
    expect(set).toContain('p-1')
    expect(set).not.toContain('p-9')
    expect(set).not.toContain('mt-9')
    expect(set).not.toContain('ml-9')
    expect(engine.extract(code, '/x/B.vue')).toEqual(set)
  })

  it('stripComments: HTML-комментарии режутся только в html-подобных файлах', () => {
    expect(stripComments('<!-- p-9 --> a', 'x.vue')).not.toContain('p-9')
    expect(stripComments('<!-- p-9 --> a', 'x.ts')).toContain('p-9')
    expect(stripComments(`const u = 'https://a/b' // c`, 'x.ts')).toContain('https://a/b')
  })
})
