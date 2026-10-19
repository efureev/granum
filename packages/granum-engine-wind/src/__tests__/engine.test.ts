import type { GranumRule } from '@feugene/granum/engine'
import { stripComments } from '@feugene/granum/engine'
import { describe, expect, it } from 'vitest'
import { extractWindClasses } from '../extract'
import { WIND_DIALECT_BASE, WIND_DIALECT_EXTRA, windEngine } from '../wind'
import { GOLDEN_CLASSES } from './fixtures/classes'

const engine = windEngine()

describe('windEngine: контракт вывода', () => {
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
    const c = await windEngine().generate({ classes: new Set(GOLDEN_CLASSES) })
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

  it('preflight отдаётся отдельным полем, не смешиваясь с утилитами', async () => {
    const out = await engine.generate({ classes: new Set(['animate-spin', 'tabular-nums']) })
    // Инициализация `--un-*` на `*` — базового уровня: она в `preflight`.
    expect(out.preflight).toContain('--un-rotate:0')
    expect(out.css).not.toContain('--un-rotate:0')
    // `@keyframes` рождает правило, а не preflight, поэтому остаётся в утилитах.
    expect(out.css).toContain('@keyframes spin')
    expect(out.css).toContain('.animate-spin{animation:spin 1s linear infinite;}')
    expect(out.css).toContain('--un-numeric-spacing:tabular-nums')
  })

  it('preflight: false — поля нет вовсе, утилиты на месте', async () => {
    const bare = await windEngine({ preflight: false }).generate({ classes: new Set(['p-4']) })
    expect(bare.preflight).toBeUndefined()
    expect(bare.css).toContain('.p-4{padding:1rem;}')
  })
})

describe('windEngine: правила провайдеров и приложения', () => {
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

  it('preflights приложения уезжают в preflight, шкала темы переопределяется', async () => {
    const out = await engine.generate({
      classes: new Set(['p-huge']),
      theme: { spacing: { huge: '99rem' } },
      preflights: [{ css: ':root{--app:1}' }, { css: ({ theme }) => `:root{--huge:${(theme.spacing as Record<string, string>).huge}}` }],
    })
    expect(out.css).toContain('.p-huge{padding:99rem;}')
    // Preflight провайдера или приложения — тоже CSS базового уровня, и в
    // слое утилит ему не место: он обязан действовать до стилей компонентов.
    expect(out.preflight).toContain(':root{--app:1}')
    expect(out.preflight).toContain(':root{--huge:99rem}')
    expect(out.css).not.toContain(':root{--app:1}')
  })

  it('preflight с явным слоем движок не перекладывает', async () => {
    const out = await engine.generate({
      classes: new Set(['p-4']),
      preflights: [{ css: ':root{--late:1}', layer: 'default' }],
    })
    expect(out.css).toContain(':root{--late:1}')
    expect(out.preflight ?? '').not.toContain('--late')
  })

  it('variablePrefix переименовывает переменные и в утилитах, и в preflight', async () => {
    const out = await windEngine({ variablePrefix: 'ds-' }).generate({ classes: new Set(['tabular-nums']) })
    expect(out.css).toContain('--ds-numeric-spacing')
    expect(out.css).not.toContain('--un-numeric-spacing')
    expect(out.preflight).toContain('--ds-rotate:0')
    expect(out.preflight).not.toContain('--un-rotate:0')
  })

  it('extraRules: false — альфа на произвольном цвете теряется, и это видно', async () => {
    // Дыра wind3: класс совпадает, но `/50` он игнорирует. Наше доп-правило её и
    // закрывает, поэтому с ним и без него это разные словари.
    const bare = await windEngine({ extraRules: false }).generate({ classes: new Set(['bg-[var(--x)]/50']) })
    expect(bare.unmatched).toEqual([])
    expect(bare.css).toContain('background-color:var(--x);')
    expect(bare.css).not.toContain('color-mix')

    const extra = await windEngine().generate({ classes: new Set(['bg-[var(--x)]/50']) })
    expect(extra.css).toContain('background-color:color-mix(in srgb, var(--x) 50%, transparent);')
  })

  it('общие кортежи правил не портятся между генераторами', async () => {
    const a = await windEngine().generate({ classes: new Set(['uppercase', 'sr-only']) })
    const b = await windEngine({ extraRules: false }).generate({ classes: new Set(['p-4']) })
    const c = await windEngine().generate({ classes: new Set(['uppercase', 'sr-only']) })
    expect(b.unmatched).toEqual([])
    expect(c.css).toBe(a.css)
    expect(c.preflight).toBe(a.preflight)
  })
})

describe('extract', () => {
  it('извлекает классы из разметки, строк и шаблонных литералов', () => {
    const code = `<template><div class="p-4 hover:bg-red bg-[var(--x)]" :class="ok ? 'border-red' : 'border-green'"></div></template>
<script setup>const cls = \`rounded-[var(--r,4px)] \${x}\`; const s = 'space-x-4 object-[50%_20%]'</script>`
    const set = extractWindClasses(code, '/x/A.vue')
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
    const set = extractWindClasses(code, '/x/B.vue')
    expect(set).toContain('p-1')
    expect(set).not.toContain('p-9')
    expect(set).not.toContain('mt-9')
    expect(set).not.toContain('ml-9')
    expect(engine.extract(code, '/x/B.vue')).toEqual(set)
  })

  it('комментарий скомпилированного шаблона Vue (createCommentVNode) не даёт классов', () => {
    const code = `const _hoisted = _createCommentVNode(" p-9 mt-9 "); const c = "p-1"; createCommentVNode('m-9')`
    const set = extractWindClasses(code, 'chunks/Panel-abc.js')
    expect(set).toContain('p-1')
    expect(set).not.toContain('p-9')
    expect(set).not.toContain('mt-9')
    expect(set).not.toContain('m-9')
  })

  it('stripComments: HTML-комментарии режутся только в html-подобных файлах', () => {
    expect(stripComments('<!-- p-9 --> a', 'x.vue')).not.toContain('p-9')
    expect(stripComments('<!-- p-9 --> a', 'x.ts')).toContain('p-9')
    expect(stripComments(`const u = 'https://a/b' // c`, 'x.ts')).toContain('https://a/b')
  })

  it('`/*` в атрибуте шаблона не съедает классы до комментария в <script>', () => {
    const sfc = '<template>\n  <input type="file" accept="image/*" class="sr-only">\n  <div class="p-4 grid-cols-[repeat(2,1fr)]">x</div>\n</template>\n<script setup lang="ts">\n/** mt-9 */\nconst a = 1\n</script>\n'
    const set = extractWindClasses(sfc, 'App.vue')
    expect(set).toContain('sr-only')
    expect(set).toContain('p-4')
    expect(set).toContain('grid-cols-[repeat(2,1fr)]')
    expect(set).not.toContain('mt-9')
  })
})

describe('windEngine: кэш вывода и словарь', () => {
  it('вывод для того же множества классов отдаётся из кэша, для другого — нет', async () => {
    const cached = windEngine({ preflight: false, extraRules: false })
    const a = await cached.generate({ classes: new Set(['p-4', 'flex']) })
    const b = await cached.generate({ classes: new Set(['flex', 'p-4']) })
    expect(b).toBe(a)
    const c = await cached.generate({ classes: new Set(['flex']) })
    expect(c).not.toBe(a)
    expect(c.css).not.toContain('.p-4')
  })

  it('доп-правило — другой диалект и другой отпечаток; префикс переменных — ни то, ни другое', () => {
    const extra = windEngine()
    const bare = windEngine({ extraRules: false })
    expect(extra.dialect).toBe(WIND_DIALECT_EXTRA)
    expect(bare.dialect).toBe(WIND_DIALECT_BASE)
    expect(bare.vocabulary).not.toBe(extra.vocabulary)
    const prefixed = windEngine({ variablePrefix: 'ds-', preflight: false })
    expect(prefixed.dialect).toBe(extra.dialect)
    expect(prefixed.vocabulary).toBe(extra.vocabulary)
  })

  it('правило приложения не меняет диалект, но меняет отпечаток', async () => {
    const withRule = windEngine({ rules: [['zz-extra', { color: 'red' }]] })
    expect(withRule.dialect).toBe(windEngine().dialect)
    expect(withRule.vocabulary).not.toBe(windEngine().vocabulary)
    const out = await withRule.generate({ classes: new Set(['zz-extra']) })
    expect(out.css).toContain('.zz-extra{color:red;}')
    expect(out.unmatched).toEqual([])
    // Тот же набор правил — тот же отпечаток: два инстанса сравнимы.
    expect(windEngine({ rules: [['zz-extra', { color: 'red' }]] }).vocabulary).toBe(withRule.vocabulary)
  })

  it('отпечаток одинаков между вызовами и не зависит от порядка правил', () => {
    const a = windEngine({ rules: [['zz-a', { color: 'red' }], ['zz-b', { color: 'blue' }]] })
    const b = windEngine({ rules: [['zz-b', { color: 'blue' }], ['zz-a', { color: 'red' }]] })
    expect(b.vocabulary).toBe(a.vocabulary)
    expect(a.vocabulary).toMatch(/^fnv64-[0-9a-f]{16}$/)
  })
})

describe('windEngine: альфа на цвете в скобках', () => {
  const engine = windEngine({ preflight: false })
  const body = async (cls: string): Promise<string | undefined> => {
    const out = await engine.generate({ classes: new Set([cls]) })
    return out.unmatched.includes(cls) ? undefined : out.css
  }

  it('цвет, который wind3 не разбирает, получает color-mix', async () => {
    expect(await body('bg-[var(--gr-bg)]/55')).toContain('background-color:color-mix(in srgb, var(--gr-bg) 55%, transparent)')
    expect(await body('bg-[--x]/50')).toContain('background-color:color-mix(in srgb, var(--x) 50%, transparent)')
  })

  it('разбираемый цвет wind3 раскрашивает сам — альфа в функции, гамма не теряется', async () => {
    expect(await body('bg-[rgb(0_0_0)]/50')).toContain('background-color:rgb(0 0 0 / 0.5)')
    expect(await body('bg-[oklch(0.5_0.1_200)]/50')).toContain('background-color:oklch(0.5 0.1 200 / 0.5)')
  })

  it('не цвет остаётся без правила, а не получает мусорный color-mix', async () => {
    expect(await body('border-[2px]/50')).toBeUndefined()
    expect(await body('bg-[length:10px_10px]/50')).toBeUndefined()
  })
})

/**
 * Вариант `dark:` по селектору тёмных режимов (E-20…E-22): селектор приходит
 * входом и отпечатка словаря не меняет — иначе приложение пересчитывало бы
 * классы всех манифестов из-за одной темы.
 */
describe('windEngine: вариант dark: по парам режимов', () => {
  const darkSelector = '[data-theme="ink-dark"], [data-theme="ink-dim"]'

  it('предок с парой каждого тёмного режима; без поля — класс .dark по умолчанию', async () => {
    const themed = await engine.generate({ classes: new Set(['dark:bg-red-500']), darkSelector })
    expect(themed.css).toContain('[data-theme="ink-dark"] .dark\\:bg-red-500')
    expect(themed.css).toContain('[data-theme="ink-dim"] .dark\\:bg-red-500')
    expect(themed.css).not.toContain('.dark .dark')
    const plain = await engine.generate({ classes: new Set(['dark:bg-red-500']) })
    expect(plain.css).toContain('.dark .dark\\:bg-red-500')
  })

  it('отпечаток словаря от селектора не зависит', async () => {
    const before = engine.vocabulary
    await engine.generate({ classes: new Set(['dark:p-1']), darkSelector })
    expect(engine.vocabulary).toBe(before)
    expect(windEngine().vocabulary).toBe(before)
  })
})
