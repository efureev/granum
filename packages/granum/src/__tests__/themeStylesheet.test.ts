/**
 * CSS темы провайдера без приложения и движка: тот же порядок слоёв и
 * те же блоки, что у сборки приложения, — для подключения дизайн-системы без granum.
 * Манифест режимов без сборки — из той же резолюции тем.
 */
import type { GranumConfig } from '../config'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defineGranumComponent, defineGranumProvider } from '../contract'
import { prepareApp } from '../node/prepare'
import { getThemeManifest, resolveThemeManifest } from '../node/themeManifest'
import { emitThemeStylesheet } from '../node/themeStylesheet'
import { granum } from '../vite/plugin'
import { catalogProvider } from './helpers'
import { testEngine } from './testEngine'

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
    const sheet = await emitThemeStylesheet({ providers: [provider, uiProvider()], theme: 'paper', modes: { names: ['light', 'dark'] }, root })
    expect(sheet.layers.tokens).toContain('--p-space: 4px;')
    expect(sheet.layers.tokens).toContain('--p-radius: 6px;')
    expect(sheet.layers.themes).toContain(':root, [data-theme="paper-light"] {')
    expect(sheet.layers.themes).toContain('--b-shadow: soft;')
    expect(sheet.layers.themes).toContain('[data-theme="paper-dark"] {')
    expect(sheet.css).toContain('@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;')
    expect(sheet.css).not.toContain('granum.utilities {')
    expect(sheet.css).not.toContain('comment')
  })

  it('без modes — только режим по умолчанию темы, как у сборки приложения', async () => {
    const { root, provider } = catalogProvider()
    const sheet = await emitThemeStylesheet({ providers: [provider], theme: 'paper', root })
    expect(sheet.layers.themes).toContain(':root, [data-theme="paper-light"] {')
    expect(sheet.layers.themes).not.toContain('paper-dark')
  })

  it('режимы и превью — как у приложения; плоский вывод без @layer', async () => {
    const { root, provider } = catalogProvider()
    const sheet = await emitThemeStylesheet({ providers: [provider, uiProvider()], theme: 'ink', previews: ['paper'], modes: { names: ['light', 'dim'] }, root, css: { layers: false } })
    expect(sheet.css).not.toContain('@layer')
    expect(sheet.layers.themes).toContain('[data-theme="ink-dim"] {')
    expect(sheet.layers.themes).not.toContain('[data-theme="ink-dark"] {')
    expect(sheet.layers.themes).toContain('[data-theme="paper-light"] {')
  })

  it('части: root без режимов, режим — его пара и фолбэки, :root — только у режима по умолчанию', async () => {
    const { root, provider } = catalogProvider()
    const sheet = await emitThemeStylesheet({ providers: [provider, uiProvider()], theme: 'paper', previews: ['ink'], modes: { names: ['light', 'dark'], system: 'media' }, root })
    const { parts } = sheet

    expect(Object.keys(parts.modes)).toEqual(['light', 'dark'])
    expect(parts.root).toContain('--p-radius: 6px;')
    expect(parts.root).not.toMatch(/paper-(?:light|dark)/)
    expect(parts.modes.light).toContain(':root, [data-theme="paper-light"] {')
    expect(parts.modes.light).not.toContain('paper-dark')
    expect(parts.modes.dark).toContain('[data-theme="paper-dark"] {')
    expect(parts.modes.dark).toContain('--b-shadow: none;')
    expect(parts.modes.dark).not.toMatch(/:root,|paper-light/)
    expect(parts.modes.dark).toContain('@media (prefers-color-scheme: dark)')
    expect(Object.keys(parts.previews)).toEqual(['ink'])
    expect(parts.previews.ink).not.toContain(':root')

    // Ничего не потеряно и не задвоено: те же строки, что у слоёв.
    const lines = (css: string): string[] => css.split('\n').filter(line => line.trim()).sort()
    expect(lines([parts.root, ...Object.values(parts.modes), ...Object.values(parts.previews)].join('\n')))
      .toEqual(lines(`${sheet.layers.tokens}\n${sheet.layers.themes}`))
  })

  it('фолбэки режима — в его части, после блока пары', async () => {
    const { root, provider } = catalogProvider()
    const fallbacks = [{ supports: 'not (color: oklch(0 0 0))', tokens: { 'p-bg': 'navy' } }]
    const sheet = await emitThemeStylesheet({
      providers: [provider],
      theme: 'paper',
      modes: { names: ['light', 'dark', 'ocean'], define: { ocean: { extends: 'dark', tokens: { 'p-bg': '#012' }, fallbacks } } },
      root,
    })
    const supports = [...sheet.layers.themes.matchAll(/@supports[^{]+\{[^@]*?\}\s*\}/g)].map(match => match[0])

    expect(supports.length).toBeGreaterThan(0)
    for (const block of supports) {
      const owner = Object.entries(sheet.parts.modes).find(([, css]) => css.includes(block))
      expect(owner, block).toBeDefined()
      expect(owner![1].indexOf(block)).toBeGreaterThan(owner![1].indexOf(`[data-theme="paper-${owner![0]}"] {`))
    }
  })

  it('tokensRef режима приложения читается от root, как у сборки приложения', async () => {
    const { root, provider } = catalogProvider()
    writeFileSync(join(root, 'ocean.css'), ':root{--p-bg:#012}')
    const sheet = await emitThemeStylesheet({ providers: [provider], theme: 'paper', modes: { define: { ocean: { extends: 'dark', tokensRef: 'ocean.css' } } }, root })
    expect(sheet.layers.themes).toMatch(/\[data-theme="paper-ocean"\] \{[^}]*--p-bg: #012;/)
  })
})

describe('resolveThemeManifest', () => {
  function app(): { root: string, config: GranumConfig } {
    const { root, provider } = catalogProvider()
    return {
      root,
      config: {
        engine: testEngine(),
        providers: [provider, uiProvider()],
        theme: 'ink',
        previews: ['paper'],
        modes: { names: ['light', 'dim', 'ocean'], define: { ocean: { extends: 'dim', title: 'Ocean', tokens: { 'p-bg': '#012' } } } },
        appSources: { dirs: [] },
      },
    }
  }

  it('совпадает с манифестом сборки приложения, включая режимы приложения и превью', async () => {
    const { root, config } = app()
    const built = getThemeManifest((await prepareApp(config, root)).resolution)
    expect(built.modes.map(mode => mode.value)).toEqual(['ink-light', 'ink-dim', 'ink-ocean'])
    expect(built.previews?.map(preview => preview.theme.id)).toEqual(['paper'])
    expect(resolveThemeManifest({ providers: config.providers, theme: config.theme!, previews: config.previews!, modes: config.modes!, root })).toEqual(built)
  })

  it('plugin.api.themeManifest отдаёт его до сборки', async () => {
    const { root, config } = app()
    const built = getThemeManifest((await prepareApp(config, root)).resolution)
    expect(await granum(config, { log: () => {} }).api!.themeManifest(root)).toEqual(built)
  })
})
