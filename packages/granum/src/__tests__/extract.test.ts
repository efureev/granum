import { describe, expect, it } from 'vitest'
import { extractClasses, stripComments } from '../engine/extract'
import { collectImportSpecifiers } from '../node/imports'
import { scanTokenConsumption } from '../node/tokenScan'

/**
 * Срез комментариев (E-12, INV-ENG-5) обязан знать про строки: `/*` внутри
 * литерала — не начало комментария. Регэксп по всему тексту съедал код до
 * ближайшего `*\/`, и классы с токенами пропадали молча (INV-DIAG-2).
 */
function classes(code: string, id: string): Set<string> {
  return extractClasses(code, id)
}

describe('stripComments: `/*` внутри строки не открывает комментарий', () => {
  it('glob со звёздочкой в TS', () => {
    const set = classes(`const icons = import.meta.glob('./icons/*.svg')\nexport const cls = 'p-4 flex'\n/** p-9 */\n`, 'src/a.ts')
    expect(set).toContain('p-4')
    expect(set).toContain('flex')
    expect(set).not.toContain('p-9')
  })

  it('заголовок Accept: */*', () => {
    const set = classes(`fetch(u, { headers: { Accept: '*/*' } })\nconst btn = 'px-4 py-2'\n/* p-9 */`, 'src/a.ts')
    expect(set).toContain('px-4')
    expect(set).toContain('py-2')
    expect(set).not.toContain('p-9')
  })

  it('шаблонная строка с вложенным выражением', () => {
    const set = classes(`const s = \`\${a ? '/*' : \`\${b}\`}x\`\nconst c = 'p-4'\n/* p-9 */`, 'src/a.ts')
    expect(set).toContain('p-4')
    expect(set).not.toContain('p-9')
  })

  it('регэксп-литерал с кавычкой и со слешем-звёздочкой', () => {
    const minified = `x.replace(/'/g,"");const a='image/*';const c="p-4";/*! p-9 */`
    expect(classes(minified, 'chunk.js')).toContain('p-4')
    expect(classes(minified, 'chunk.js')).not.toContain('p-9')

    const set = classes(`const re = /\\/*/g\nconst c = 'p-4'\n/* p-9 */`, 'src/a.ts')
    expect(set).toContain('p-4')
    expect(set).not.toContain('p-9')
  })

  it('апостроф и `/*` в строчном комментарии не ломают разбор', () => {
    const set = classes(`// don't /* here\nconst c = 'p-4'\n/* p-9 */`, 'src/a.ts')
    expect(set).toContain('p-4')
    expect(set).not.toContain('p-9')
  })

  it('незакрытый `/*` ничего не съедает', () => {
    expect(stripComments(`const a = 'p-4' /* oops`, 'src/a.ts')).toBe(`const a = 'p-4' /* oops`)
  })
})

describe('stripComments: разметка', () => {
  it('accept="image/*" в шаблоне SFC и JSDoc в <script>', () => {
    const sfc = [
      '<template>',
      '  <input type="file" accept="image/*" class="sr-only">',
      '  <div class="p-4 flex gap-2">x</div>',
      '</template>',
      '<script setup lang="ts">',
      '/** p-9 */',
      'const a = 1',
      '</script>',
      '',
    ].join('\n')
    const set = classes(sfc, 'App.vue')
    for (const c of ['sr-only', 'p-4', 'flex', 'gap-2'])
      expect(set).toContain(c)
    expect(set).not.toContain('p-9')
  })

  it('`/*` в тексте разметки — проза, а комментарии <style> режутся', () => {
    const set = classes('<p>Accepts image/* files</p>\n<div class="p-4"></div>\n<style>/* p-9 */ .a{}</style>', 'x.html')
    expect(set).toContain('p-4')
    expect(set).not.toContain('p-9')
  })

  it('<script> внутри HTML-комментария не открывает скрипт', () => {
    const set = classes('<!-- <script> -->\n<p>image/*</p>\n<div class="p-4"></div>\n<style>/* p-9 */</style>', 'x.vue')
    expect(set).toContain('p-4')
    expect(set).not.toContain('p-9')
  })

  it('frontmatter .astro и `{/* … */}` в разметке', () => {
    const astro = '---\n/* p-8 */\nconst a = \'p-4\'\n---\n<div class="p-5">{/* p-9 */}</div>\n'
    const set = classes(astro, 'Page.astro')
    expect(set).toContain('p-4')
    expect(set).toContain('p-5')
    expect(set).not.toContain('p-8')
    expect(set).not.toContain('p-9')
  })

  it('в разметке режутся HTML-комментарии и строчные `//` целой строкой — как раньше', () => {
    const set = classes('<template lang="pug">\n// p-8\ndiv.p-4\n</template>\n<!-- p-9 -->', 'x.vue')
    expect(set).not.toContain('p-8')
    expect(set).not.toContain('p-9')
    expect(stripComments('// p-9\nconst a = \'p-4\'', 'src/a.ts')).not.toContain('p-9')
  })
})

describe('stripComments: CSS', () => {
  it('`/*` в строке content не съедает потребление токенов', () => {
    const css = '.u::after{content:"drop image/*"}\n.u{background:var(--xh-bg)}\n/* var(--xh-dead) */'
    const uses = scanTokenConsumption(css, 'a.css').uses
    expect([...uses.keys()]).toEqual(['xh-bg'])
  })

  it('нецитированный url() со звёздочкой', () => {
    const css = '.a{background:url(/img/*.png)}\n.b{color:var(--xh-fg)}\n/* var(--xh-dead) */'
    expect([...scanTokenConsumption(css, 'a.css').uses.keys()]).toEqual(['xh-fg'])
  })
})

describe('collectImportSpecifiers: комментарии срезаются с учётом строк (INV-BND-1)', () => {
  it('импорт после glob со звёздочкой не теряется', () => {
    const code = `const icons = import.meta.glob('./icons/*.svg')\nimport { readFileSync } from 'node:fs'\n/** doc */\n`
    expect(collectImportSpecifiers(code)).toContain('node:fs')
  })

  it('require() — тоже импорт', () => {
    expect(collectImportSpecifiers(`const fs = require('node:fs')\nconst x = require("css-tree")\n`)).toEqual(['css-tree', 'node:fs'])
  })

  it('спецификатор без пробелов: строка "import" в коде не склеивает текст до ближайшей кавычки', () => {
    // Так выглядит собранный codegen: закрывающая кавычка строки `"import"`
    // давала «голый импорт» со спецификатором в полстраницы кода.
    const code = 'const entryFor = options.entryStyle === "import" ? (c) => c : (c) => ({\n  types: \'x\' })\n'
    expect(collectImportSpecifiers(code)).toEqual([])
  })

  it('импорт в комментарии не считается, URL в строке не режется', () => {
    const code = `const u = 'https://cdn.example/x' // import 'node:path'\n/* import 'node:os' */\nimport a from './a.js'\n`
    expect(collectImportSpecifiers(code)).toEqual(['./a.js'])
  })
})
