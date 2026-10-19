/**
 * CSS темы провайдера без приложения и движка (T-16): тот же порядок слоёв и
 * те же блоки, что у сборки приложения, — для подключения дизайн-системы без granum.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defineGranumComponent, defineGranumProvider } from '../contract'
import { emitThemeStylesheet } from '../node/themeStylesheet'
import { catalogProvider } from './helpers'

/** Провайдер компонентов объектной формой: токены по темам — папкой у `config.ts`, раскладки `dist` нет. */
function uiProvider(): ReturnType<typeof defineGranumProvider> {
  const dir = mkdtempSync(join(tmpdir(), 'granum-stylesheet-'))
  mkdirSync(join(dir, 'Button/themes/paper/modes'), { recursive: true })
  writeFileSync(join(dir, 'Button/themes/paper/modes/light.json'), JSON.stringify({ '$comment': 'тень — только светлому', 'b-shadow': 'soft' }))
  writeFileSync(join(dir, 'Button/themes/paper/modes/dark.json'), JSON.stringify({ 'b-shadow': 'none' }))
  return defineGranumProvider({
    id: '@p/ui',
    contractVersion: 2,
    dependencies: ['@p/ds'],
    components: [defineGranumComponent(pathToFileURL(join(dir, 'Button/config.ts')).href, { name: 'Button', themesDir: './themes' })],
  })
}

describe('emitThemeStylesheet', () => {
  it('слои tokens и themes темы с токенами компонентов; ни утилит, ни CSS компонентов', async () => {
    const { root, provider } = catalogProvider({ tokensCss: ':root { --p-space: 4px; }\n' })
    const sheet = await emitThemeStylesheet({ providers: [provider, uiProvider()], theme: 'paper', root })
    expect(sheet.layers.tokens).toContain('--p-space: 4px;')
    expect(sheet.layers.tokens).toContain('--p-radius: 6px;')
    expect(sheet.layers.themes).toContain(':root, [data-theme="paper-light"] {')
    expect(sheet.layers.themes).toContain('--b-shadow: soft;')
    expect(sheet.layers.themes).toContain('[data-theme="paper-dark"] {')
    expect(sheet.css).toContain('@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;')
    expect(sheet.css).not.toContain('granum.utilities {')
    expect(sheet.css).not.toContain('comment')
  })

  it('режимы и превью — как у приложения; плоский вывод без @layer', async () => {
    const { root, provider } = catalogProvider()
    const sheet = await emitThemeStylesheet({ providers: [provider, uiProvider()], theme: 'ink', previews: ['paper'], modes: { names: ['light', 'dim'] }, root, css: { layers: false } })
    expect(sheet.css).not.toContain('@layer')
    expect(sheet.layers.themes).toContain('[data-theme="ink-dim"] {')
    expect(sheet.layers.themes).not.toContain('[data-theme="ink-dark"] {')
    expect(sheet.layers.themes).toContain('[data-theme="paper-light"] {')
  })
})
