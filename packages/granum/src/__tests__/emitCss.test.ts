import type { GranumConfig } from '../config'
import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CssReadError, TokenRefError } from '../core/errors'
import { emitCss, LAYER_NAMES, wrapLayer, wrapLayers } from '../node/emit'
import { buildReport } from '../node/report'
import { makeManifest, makeProvider, prepareTestApp, TEST_ENGINE } from './helpers'
import { testEngine } from './testEngine'

/** Провайдер-манифест с файлами на диске: tokens, base, тема, CSS компонента. */
function fixture(): { root: string, manifest: ReturnType<typeof makeManifest> } {
  const root = mkdtempSync(join(tmpdir(), 'granum-emit-'))
  const dist = join(root, 'node_modules/@x/kit/dist')
  mkdirSync(join(dist, 'theme'), { recursive: true })
  mkdirSync(join(dist, 'components/Card'), { recursive: true })
  mkdirSync(join(dist, 'components/Panel'), { recursive: true })
  writeFileSync(join(dist, 'theme/tokens.css'), ':root {\n  --space: 8px;\n  --unused: 1px;\n  --derived: calc(var(--space) * 2);\n}\n')
  writeFileSync(join(dist, 'theme/base.css'), 'body { margin: var(--space) }\n')
  writeFileSync(join(dist, 'theme/dark.css'), '.dark {\n  --bg: #000;\n  --dark-unused: 1;\n}\n')
  writeFileSync(join(dist, 'components/Card/styles.css'), '.card{padding:var(--derived);background:var(--bg)}\n')
  writeFileSync(join(dist, 'components/Panel/styles.css'), '.panel{display:flex}\n')
  const loaded = makeManifest('@x/kit', {
    Card: { classes: ['p-4', 'flex'], css: ['components/Card/styles.css'], tokens: { declares: {}, consumes: ['--derived'], dynamic: [] } },
    Panel: { classes: ['gap-2'], css: ['components/Panel/styles.css'], dependencies: ['Card'], safelist: ['p-4', 'shadow-legacy'] },
  }, {
    theme: { tokensCss: 'theme/tokens.css', baseCss: 'theme/base.css', themes: { dark: 'theme/dark.css' }, defaultThemes: ['light', 'dark'], tokenDefinitions: { light: { tokens: { accent: 'red' } } }, declares: ['--space', '--unused', '--derived', '--bg', '--dark-unused', '--accent'] },
  })
  const manifest = { manifest: loaded.manifest, baseUrl: `${pathToFileURL(dist).href}/` }
  return { root, manifest }
}

async function run(config: Partial<GranumConfig> = {}): Promise<{ css: Awaited<ReturnType<typeof emitCss>>, app: Awaited<ReturnType<typeof prepareTestApp>> }> {
  const { root, manifest } = fixture()
  const app = await prepareTestApp({ providers: [manifest], ...config }, root)
  return { css: await emitCss(app), app }
}

describe('emitCss: слои и порядок; utilities позже components', () => {
  it('пять слоёв в фиксированном порядке, объявление порядка первой строкой', async () => {
    const { css } = await run({ components: ['@x/kit:Panel'] })
    expect(css.css.startsWith('@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;\n')).toBe(true)
    const order = LAYER_NAMES.map(n => css.css.indexOf(`@layer granum.${n} {`))
    expect(order.every((pos, i) => pos > 0 && (i === 0 || pos > order[i - 1]!))).toBe(true)
    expect(css.layers.tokens).toContain('--space: 8px')
    expect(css.layers.base).toContain('body { margin')
    // Структурный `:root` — в слое tokens после файлов токенов, блоки остальных тем — в themes.
    expect(css.layers.tokens).toContain(':root {\n  --accent: red;\n}')
    expect(css.layers.tokens.indexOf('--space: 8px')).toBeLessThan(css.layers.tokens.indexOf('--accent: red'))
    expect(css.layers.themes).not.toContain(':root')
    expect(css.layers.themes).toContain('.dark {')
    // Компоненты — в порядке селекции: зависимость раньше зависящего.
    expect(css.layers.components.indexOf('.card')).toBeLessThan(css.layers.components.indexOf('.panel'))
    expect(css.layers.utilities).toContain('.p-4{padding:1rem;}')
    expect(css.layers.utilities).toContain('.gap-2{gap:0.5rem;}')
  })

  it('тема `:root` не перекрывает тему с селектором при любом порядке names', async () => {
    // `:root` и `.dark` равны по специфичности: в одном слое победил бы стоящий
    // позже, и при `names: ['dark', 'light']` тёмная тема не включалась бы никогда.
    const loaded = makeManifest('@x/kit', { Card: {} }, {
      theme: {
        themes: {},
        defaultThemes: ['light', 'dark'],
        tokenDefinitions: { light: { tokens: { bg: 'white' } }, dark: { selector: '.dark', tokens: { bg: 'black' } } },
        declares: ['--bg'],
      },
    })
    const root = mkdtempSync(join(tmpdir(), 'granum-emit-'))
    const app = await prepareTestApp({ providers: [loaded], components: ['@x/kit:Card'], themes: { names: ['dark', 'light'] } }, root)
    const css = await emitCss(app)

    expect(css.layers.tokens).toContain(':root {\n  --bg: white;\n}')
    expect(css.layers.themes).toContain('.dark {\n  --bg: black;\n}')
    expect(css.layers.themes).not.toContain(':root')
  })

  it('тема приложения из одних tokens — в слое themes под своим селектором', async () => {
    const { css } = await run({ components: ['@x/kit:Card'], themes: { names: ['light', 'brand'], define: { brand: { tokens: { bg: 'red' } } } } })
    expect(css.layers.themes).toContain('[data-theme="brand"] {\n  --bg: red;\n}')
    expect(css.layers.tokens).not.toContain('--bg: red')
  })

  it('конкатенация срезов по слоям равна целому; плоский режим без @layer', async () => {
    const { css } = await run()
    expect(wrapLayers(css.layers, {})).toBe(css.css)
    // Срез слоя — самостоятельный файл: своя обёртка `@layer`, а объявление
    // порядка несёт первый непустой слой. Тогда конкатенация срезов в порядке
    // слоёв побайтно равна целому.
    const slices = LAYER_NAMES.map(name => wrapLayer(css.layers, name, {})).join('')
    expect(slices).toBe(css.css)
    // Пустой слой ассета не порождает.
    const onlyTokens = { ...css.layers, base: '', themes: '', components: '', utilities: '' }
    expect(wrapLayer(onlyTokens, 'base', {})).toBe('')
    expect(wrapLayer(onlyTokens, 'tokens', {})).toContain('@layer granum.tokens, granum.base')
    // `declareOrder: false` — объявление живёт отдельным ассетом.
    expect(wrapLayer(onlyTokens, 'tokens', {}, { declareOrder: false })).not.toContain('granum.base,')
    const flat = wrapLayers(css.layers, { layers: false })
    expect(flat).not.toContain('@layer')
    expect(flat.indexOf('--space: 8px')).toBeLessThan(flat.indexOf('body { margin'))
    const prefixed = wrapLayers(css.layers, { layerPrefix: 'ds' })
    expect(prefixed).toContain('@layer ds.tokens {')
  })

  it('вход движка = классы манифестов ∪ safelist ∪ приложение; класс без правила — в unmatched', async () => {
    const { css } = await run({ components: ['@x/kit:Panel'] })
    expect(css.engineInput).toEqual(['flex', 'gap-2', 'p-4', 'shadow-legacy'])
    expect(css.engine.unmatched).toEqual(['shadow-legacy'])
    expect(css.safelistRedundant).toEqual(['p-4'])
  })

  it('cSS компонента вне селекции не эмитится', async () => {
    const { css } = await run({ components: ['@x/kit:Card'] })
    expect(css.layers.components).not.toContain('.panel')
    expect(css.layers.utilities).not.toContain('gap-2')
  })

  it('отсутствующий файл — CssReadError с провайдером и секцией', async () => {
    const { root, manifest } = fixture()
    const broken = { ...manifest, manifest: { ...manifest.manifest, theme: { ...manifest.manifest.theme, baseCss: 'theme/nope.css' } } }
    const app = await prepareTestApp({ providers: [broken] }, root)
    await expect(emitCss(app)).rejects.toBeInstanceOf(CssReadError)
    await expect(emitCss(app)).rejects.toMatchObject({ providerId: '@x/kit', section: 'base' })
  })
})

describe('emitCss: preflight движка', () => {
  const PREFLIGHT = '*,::before,::after{--un-rotate:0;}'

  it('preflight уезжает в base и стоит перед base.css провайдера', async () => {
    const { root, manifest } = fixture()
    const app = await prepareTestApp(
      { providers: [manifest], components: ['@x/kit:Panel'], engine: testEngine({ preflight: PREFLIGHT }) },
      root,
    )
    const css = await emitCss(app)

    expect(css.layers.base).toContain(PREFLIGHT)
    // Порядок внутри слоя нормативен: reset движка обязан действовать ДО
    // `base.css` провайдера, иначе тот не сможет его переопределить.
    expect(css.layers.base.indexOf(PREFLIGHT)).toBeLessThan(css.layers.base.indexOf('body { margin'))
  })

  it('в слое утилит preflight отсутствует', async () => {
    const { root, manifest } = fixture()
    const app = await prepareTestApp(
      { providers: [manifest], components: ['@x/kit:Panel'], engine: testEngine({ preflight: PREFLIGHT }) },
      root,
    )
    const css = await emitCss(app)

    expect(css.layers.utilities).not.toContain('--un-rotate')
    expect(css.layers.utilities).toContain('.gap-2{gap:0.5rem;}')
  })

  it('движок без preflight не меняет слой base ни на байт', async () => {
    const { root, manifest } = fixture()
    const withOut = await emitCss(await prepareTestApp({ providers: [manifest], components: ['@x/kit:Panel'] }, root))
    const fresh = fixture()
    const withEmpty = await emitCss(await prepareTestApp(
      { providers: [fresh.manifest], components: ['@x/kit:Panel'], engine: testEngine() },
      fresh.root,
    ))

    expect(withEmpty.layers.base).toBe(withOut.layers.base)
  })
})

describe('emitCss: обрезка токенов', () => {
  it('off и report не меняют ни байта; on удаляет неиспользуемые, сохраняя замыкание и base', async () => {
    const off = await run({ components: ['@x/kit:Card'] })
    const report = await run({ components: ['@x/kit:Card'], pruneTokens: { mode: 'report' } })
    expect(report.css.css).toBe(off.css.css)
    expect(report.css.prune?.removable).toEqual(['dark-unused', 'unused'])
    const on = await run({ components: ['@x/kit:Card'], pruneTokens: { mode: 'on' } })
    expect(on.css.layers.tokens).not.toContain('--unused')
    expect(on.css.layers.tokens).toContain('--space: 8px')
    expect(on.css.layers.tokens).toContain('--derived')
    expect(on.css.layers.themes).not.toContain('--dark-unused')
    expect(on.css.layers.themes).toContain('--bg: #000')
    expect(on.css.layers.base).toBe(off.css.layers.base)
    // `--space` держит правило base (inlined-rule); `--derived` — потребление Card (usage).
    expect(on.css.prune?.kept.get('space')?.kind).toBe('inlined-rule')
    expect(on.css.prune?.kept.get('derived')?.kind).toBe('usage')
  })

  it('токен, на который ссылается только вывод движка, не режется', async () => {
    // Утилита держит `--unused` телом декларации: ни `consumes`, ни CSS компонента о нём не знают.
    const engine = testEngine({ vocabulary: TEST_ENGINE.vocabulary, extra: { flex: 'display:flex;gap:var(--unused);' } })
    const utility = await run({ components: ['@x/kit:Card'], pruneTokens: { mode: 'on' }, engine })
    expect(utility.css.layers.utilities).toContain('var(--unused)')
    expect(utility.css.layers.tokens).toContain('--unused: 1px')
    expect(utility.css.prune?.kept.get('unused')?.kind).toBe('engine-css')

    const preflight = await run({ components: ['@x/kit:Card'], pruneTokens: { mode: 'on' }, engine: testEngine({ preflight: 'body{color:var(--unused)}' }) })
    expect(preflight.css.layers.tokens).toContain('--unused: 1px')
  })

  it('исходники приложения держат токен и дают классы', async () => {
    const { root, manifest } = fixture()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/App.vue'), '<template><div class="text-[var(--unused)] mx-auto"></div></template>')
    const app = await prepareTestApp({ providers: [manifest], components: ['@x/kit:Card'], appSources: { dirs: ['src'] }, pruneTokens: { mode: 'on' } }, root)
    const css = await emitCss(app)
    expect(css.layers.tokens).toContain('--unused')
    expect(css.layers.utilities).toContain('.mx-auto{')
    expect(css.engineInput).toContain('text-[var(--unused)]')
  })
})

describe('buildReport', () => {
  it('отчёт считается из той же эмиссии', async () => {
    const { root, manifest } = fixture()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/App.vue'), '<template><div class="bg-[var(--ghost)]"></div></template>')
    const app = await prepareTestApp({ providers: [manifest], components: ['@x/kit:Panel'], appSources: { dirs: ['src'] }, pruneTokens: { mode: 'report' } }, root)
    const css = await emitCss(app)
    const report = buildReport(app, css)
    expect(report.selection.map(s => s.key)).toEqual(['@x/kit:Card', '@x/kit:Panel'])
    expect(report.selection[1]!.dependencies).toEqual(['@x/kit:Card'])
    expect(report.themes).toEqual({ names: ['light', 'dark'], namesSource: 'provider-defaults' })
    expect(report.classes.unmatched).toEqual([{ className: 'shadow-legacy', sources: ['@x/kit:Panel'] }])
    expect(report.classes.safelistRedundant).toEqual(['p-4'])
    // `--ghost` потребляет разметка приложения, а не компонент: вердикт — тот же,
    // что у доктора, и токены приложения в него не входят.
    expect(report.tokens.undefined).toEqual([])
    expect(report.prune?.removable).toEqual(['dark-unused', 'unused'])
    expect(report.sizes.total.raw).toBe(Buffer.byteLength(css.css))
    expect(report.sizes.utilities.gzip).toBeGreaterThan(0)
  })

  /**
   * `classes.app` — не весь словарь разметки, а его пересечение с классами
   * компонентов. Ровно оно нужно аудиту, а полный список на витрине
   * дизайн-системы — это 33 тысячи имён и 750 kB JSON на каждую сборку.
   *
   * Считаются классы ВСЕХ компонентов графа, а не только выбранных: без
   * этого из списка выпадают ровно те имена, ради которых поле и заведено.
   */
  it('classes.app — только то, что есть у компонентов, включая невыбранные', async () => {
    const { root, manifest } = fixture()
    mkdirSync(join(root, 'src'), { recursive: true })
    // `flex` есть у выбранного Card, `gap-2` — у невыбранного Panel,
    // `mx-auto` — только у приложения.
    writeFileSync(join(root, 'src/App.vue'), '<template><div class="flex gap-2 mx-auto"></div></template>')
    const app = await prepareTestApp({ providers: [manifest], components: ['@x/kit:Card'], appSources: { dirs: ['src'] } }, root)
    const report = buildReport(app, await emitCss(app))

    expect(report.classes.app).toEqual(['flex', 'gap-2'])
  })

  /**
   * brotli качества 11 стоит 151 мс на 222 kB против 2 мс у gzip и считается на
   * каждый слой дважды — эмиссия и бандл. Платить это на каждой сборке за
   * число, которое смотрят редко, незачем, поэтому по умолчанию его нет.
   */
  it('brotli считается только по просьбе конфига', async () => {
    const { root, manifest } = fixture()
    const base = { providers: [manifest], components: ['@x/kit:Panel'] } as const

    const plain = await prepareTestApp({ ...base }, root)
    const plainReport = buildReport(plain, await emitCss(plain))
    expect(plainReport.sizes.total.brotli).toBeUndefined()
    expect(plainReport.emissionSizes.total.brotli).toBeUndefined()
    expect(plainReport.sizes.total.gzip).toBeGreaterThan(0)

    const asked = await prepareTestApp({ ...base, report: { brotli: true } }, root)
    const askedReport = buildReport(asked, await emitCss(asked))
    expect(askedReport.sizes.total.brotli).toBeGreaterThan(0)
    expect(askedReport.emissionSizes.total.brotli).toBeGreaterThan(0)
  })
})

describe('buildReport: класс разметки приложения без правила', () => {
  /** Приложение с опечаткой в атрибуте класса и словами в тексте разметки. */
  async function markupApp() {
    const root = mkdtempSync(join(tmpdir(), 'granum-markup-'))
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/App.vue'), `<template><div class="p-4 not-a-rule-xyz">text words</div></template>\n`)
    const app = await prepareTestApp({ providers: [makeProvider('@x/empty')], appSources: { dirs: ['src'] } }, root)
    return { app, css: await emitCss(app) }
  }
  const fromMarkup = (report: ReturnType<typeof buildReport>): string[] =>
    report.classes.unmatched.filter(u => u.sources.includes('src/App.vue')).map(u => u.className)

  it('в CSS бандла класса нет — в unmatched с файлом; слова текста — нет', async () => {
    const { app, css } = await markupApp()
    expect(fromMarkup(buildReport(app, css, { bundleCss: css.css }))).toEqual(['not-a-rule-xyz'])
  })

  it('класс объявлен в CSS бандла — не находка; CSS бандла нет — вердикта нет', async () => {
    const { app, css } = await markupApp()
    expect(fromMarkup(buildReport(app, css, { bundleCss: `${css.css}\n.not-a-rule-xyz{color:red}` }))).toEqual([])
    expect(fromMarkup(buildReport(app, css))).toEqual([])
  })
})

describe('prepareApp: tokensRef тем приложения', () => {
  it('значения читаются из CSS относительно корня, литералы важнее, as → селектор; битая ссылка — TokenRefError', async () => {
    const { root, manifest } = fixture()
    mkdirSync(join(root, 'src/themes'), { recursive: true })
    writeFileSync(join(root, 'src/themes/crimson.css'), ':root{--app-bg:#111;--app-fg:#eee}')
    const app = await prepareTestApp({
      providers: [manifest],
      themes: { define: { crimson: { tokensRef: { url: 'src/themes/crimson.css', as: '.crimson' }, tokens: { 'app-fg': '#fff' } } } },
    }, root)
    const blocks = app.resolution.tokenLayers.get('crimson')!
    expect(blocks[0]!.selector).toBe('.crimson')
    expect(blocks[0]!.tokens.get('app-bg')!.effective).toBe('#111')
    expect(blocks[0]!.tokens.get('app-fg')!.effective).toBe('#fff')
    await expect(prepareTestApp({ providers: [manifest], themes: { define: { x: { tokensRef: 'src/themes/none.css' } } } }, root)).rejects.toBeInstanceOf(TokenRefError)
  })
})

describe('prepareApp: провайдеры и селекция', () => {
  it('объектная форма — предупреждение; imports — селекция из исходников', async () => {
    const { root, manifest } = fixture()
    const object = makeProvider('obj', { components: [{ name: 'Z' }] })
    const app = await prepareTestApp({ providers: [manifest, object] }, root)
    expect(app.warnings).toContainEqual({ kind: 'provider-without-manifest', providerId: 'obj' })

    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/main.ts'), `import { Panel } from '@x/kit/components/Panel'`)
    const byImports = await prepareTestApp({ providers: [manifest], components: 'imports', appSources: { dirs: ['src'] } }, root)
    expect(byImports.resolution.selection.order).toEqual(['@x/kit:Card', '@x/kit:Panel'])
    expect(byImports.appScan.componentImports).toEqual(['@x/kit:Panel'])
  })
})
