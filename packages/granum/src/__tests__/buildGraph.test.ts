import type { BundleLike } from '../build/graph'
import { describe, expect, it } from 'vitest'
import { analyzeBundle, findUndeclaredEdges } from '../build/graph'
import { defineGranumComponent } from '../contract'
import { createEngine } from '../engine/builtin'

const engine = createEngine()
const root = 'file:///pkg/src/components'

function chunk(fileName: string, code: string, imports: string[] = [], extra: Partial<BundleLike[string]> = {}): BundleLike[string] {
  return { type: 'chunk', fileName, name: fileName.replace(/\.js$/, ''), code, isEntry: fileName.endsWith('/index.js') || fileName === 'index.js', imports, dynamicImports: [], ...extra } as BundleLike[string]
}

const bundle: BundleLike = {
  'components/XhPanel/index.js': chunk('components/XhPanel/index.js', `import { C } from '../XhCard/index.js'; import { z } from '../../chunks/overlayZ-a.js'; const cls = "flex gap-[var(--xh-space-2)]"; el.style.setProperty('--xh-panel-bg', v)`, ['components/XhCard/index.js', 'chunks/overlayZ-a.js'], { viteMetadata: { importedCss: new Set(['components/XhPanel/styles.css']) } }),
  'components/XhCard/index.js': chunk('components/XhCard/index.js', `const c = "p-4 rounded-[var(--xh-radius-md)]"; import X from '@feugene/simple-package/components/XTest1'`, ['@feugene/simple-package/components/XTest1', 'vue']),
  'components/XhTable/index.js': chunk('components/XhTable/index.js', `import H from '../../groups/data/shared/Header-b.js'; const c = "w-full odd:bg-[var(--xh-table-stripe)]"`, ['groups/data/shared/Header-b.js']),
  'groups/data/shared/Header-b.js': chunk('groups/data/shared/Header-b.js', `const c = "px-[var(--xh-space-3)]"`),
  'chunks/overlayZ-a.js': chunk('chunks/overlayZ-a.js', `export const DROPDOWN_Z_VAR = '--xh-z-dropdown'`),
  'components/XhPanel/styles.css': { type: 'asset', fileName: 'components/XhPanel/styles.css', source: '.xh-panel{gap:var(--xh-space-4)}' },
  'index.js': chunk('index.js', `import 'node:fs'; import './granum-node-only.js'`, ['node:fs', '@feugene/granum/node', 'components/XhPanel/index.js']),
}

const descriptors = [
  defineGranumComponent(`${root}/XhPanel/config.ts`, { name: 'XhPanel', dependencies: ['XhCard'], cssFiles: ['./styles.css'] }),
  defineGranumComponent(`${root}/XhCard/config.ts`, { name: 'XhCard' }),
  defineGranumComponent(`${root}/data/XhTable/config.ts`, { name: 'XhTable', group: 'data' }),
]

describe('analyzeBundle (B-6…B-9)', async () => {
  const analysis = await analyzeBundle(bundle, descriptors, engine, { indexEntry: 'index.js' })

  it('файлы компонента — до чужих entry; общий чанк и общий sfc группы входят', () => {
    expect(analysis.components.get('XhPanel')!.files).toEqual(['chunks/overlayZ-a.js', 'components/XhPanel/index.js'])
    expect(analysis.components.get('XhTable')!.files).toEqual(['components/XhTable/index.js', 'groups/data/shared/Header-b.js'])
  })

  it('классы — только токены с правилом; токены — из кода, литералов и css-ассетов (INV-MAN-5)', () => {
    const panel = analysis.components.get('XhPanel')!
    expect(panel.classes).toEqual(['flex', 'gap-[var(--xh-space-2)]'])
    expect(panel.consumes).toEqual(['--xh-panel-bg', '--xh-space-2', '--xh-space-4', '--xh-z-dropdown'])
    expect(panel.cssAssets).toEqual(['components/XhPanel/styles.css'])
    expect(analysis.components.get('XhTable')!.classes).toEqual(['odd:bg-[var(--xh-table-stripe)]', 'px-[var(--xh-space-3)]', 'w-full'])
  })

  it('рёбра: свои entry и кросс-провайдерные импорты', () => {
    expect(analysis.components.get('XhPanel')!.edges).toEqual(['XhCard'])
    expect(analysis.components.get('XhCard')!.edges).toEqual(['@feugene/simple-package:XTest1'])
  })

  it('граница: node-импорты, node-entry granum, data-url — только в браузерных файлах (B-16)', async () => {
    expect(analysis.violations).toEqual([
      { file: 'index.js', specifier: 'node:fs', kind: 'node-import' },
      { file: 'index.js', specifier: '@feugene/granum/node', kind: 'granum-node-entry' },
    ])
    const withData: BundleLike = { ...bundle, 'components/XhCard/index.js': chunk('components/XhCard/index.js', `const u = "data:text/css;base64,AAA"`) }
    expect((await analyzeBundle(withData, descriptors, engine)).violations).toEqual([{ file: 'components/XhCard/index.js', specifier: 'data:text/css', kind: 'data-url' }])
  })
})

describe('findUndeclaredEdges (INV-CON-5, INV-CON-6)', () => {
  it('объявленное и транзитивно покрытое ребро — норма; неучтённое — нарушение', async () => {
    const analysis = await analyzeBundle(bundle, descriptors, engine)
    expect(findUndeclaredEdges('@x/heavy', descriptors, analysis)).toEqual([['XhCard', '@feugene/simple-package:XTest1']])
    const declared = [
      descriptors[0]!,
      defineGranumComponent(`${root}/XhCard/config.ts`, { name: 'XhCard', dependencies: ['@feugene/simple-package:XTest1'] }),
      descriptors[2]!,
    ]
    expect(findUndeclaredEdges('@x/heavy', declared, await analyzeBundle(bundle, declared, engine))).toEqual([])
  })

  it('импорт общего модуля вне components/ ребром не считается', async () => {
    const analysis = await analyzeBundle(bundle, descriptors, engine)
    expect(analysis.components.get('XhPanel')!.edges).not.toContain('chunks/overlayZ-a.js')
  })
})
