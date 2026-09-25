import type { GranumConfig } from '../config'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countDoctorDiagnostics, formatDoctorReport, formatExplainReport, formatTokenPruneReport, formatTokensReport, formatWhyCssReport, granumDoctor, granumExplain, granumTokenPrune, granumTokens, granumWhyCss } from '../node/diagnostics/index'
import { prepareApp } from '../node/prepare'
import { makeManifest } from './helpers'

interface Fixture {
  root: string
  dist: string
  manifest: ReturnType<typeof makeManifest> & { baseUrl: string }
}

/** Провайдер-манифест на диске: tokens, base, тема, CSS и JS компонентов. */
function fixture(patch: { cardCss?: string, cardJs?: string, warnings?: any[] } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'granum-diag-'))
  const dist = join(root, 'node_modules/@x/kit/dist')
  mkdirSync(join(dist, 'theme'), { recursive: true })
  mkdirSync(join(dist, 'components/Card'), { recursive: true })
  mkdirSync(join(dist, 'components/Panel'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(dist, 'theme/tokens.css'), ':root {\n  --space: 8px;\n  --unused: 1px;\n  --derived: calc(var(--space) * 2);\n}\n')
  writeFileSync(join(dist, 'theme/base.css'), 'body { margin: var(--space) }\n')
  writeFileSync(join(dist, 'theme/dark.css'), '.dark {\n  --bg: #000;\n  --dark-unused: 1;\n}\n')
  writeFileSync(join(dist, 'components/Card/styles.css'), patch.cardCss ?? '.card{padding:var(--derived);background:var(--bg)}\n')
  writeFileSync(join(dist, 'components/Card/index.js'), patch.cardJs ?? 'export const Card = 1\n')
  writeFileSync(join(dist, 'components/Panel/styles.css'), '.panel{display:flex}\n')
  writeFileSync(join(dist, 'components/Panel/index.js'), 'import "../Card/index.js"\nexport const Panel = 2\n')
  writeFileSync(join(root, 'src/App.vue'), '<template><div class="panel-app text-[var(--app-only)] gap-2"/></template>\n')
  const loaded = makeManifest('@x/kit', {
    Card: { classes: ['p-4', 'flex'], css: ['components/Card/styles.css'], tokens: { declares: { light: { tokens: { 'card-pad': 'var(--space)' } } }, consumes: ['--derived', '--bg', '--nowhere'], dynamic: [] } },
    Panel: { classes: ['gap-2'], css: ['components/Panel/styles.css'], dependencies: ['Card'], safelist: ['p-4', 'shadow-legacy'] },
  }, {
    theme: { tokensCss: 'theme/tokens.css', baseCss: 'theme/base.css', themes: { dark: 'theme/dark.css' }, defaultThemes: ['light', 'dark'], tokenDefinitions: { light: { tokens: { accent: 'red' } } }, declares: ['--space', '--unused', '--derived', '--bg', '--dark-unused', '--accent'] },
    ...(patch.warnings ? { warnings: patch.warnings } : {}),
  })
  return { root, dist, manifest: { manifest: loaded.manifest, baseUrl: `${pathToFileURL(dist).href}/` } }
}

async function app(f: Fixture, config: Partial<GranumConfig> = {}) {
  return prepareApp({ providers: [f.manifest], components: ['@x/kit:Panel'], appSources: { dirs: ['src'] }, ...config }, f.root)
}

describe('granum doctor (D-2)', () => {
  it('чистая конфигурация: ok, предупреждения только по делу', async () => {
    const report = await granumDoctor(await app(fixture()))
    expect(report.ok).toBe(true)
    expect(report.providers).toEqual([{ id: '@x/kit', form: 'manifest', version: '0.0.0', components: 2, hasTheme: true, hasEngine: false }])
    expect(report.components.map(c => c.key)).toEqual(['@x/kit:Card', '@x/kit:Panel'])
    expect(report.themes.names).toEqual(['light', 'dark'])
    expect(report.files.missing).toEqual([])
    const codes = report.diagnostics.map(d => d.code)
    // `--nowhere` никем не объявлен; `shadow-legacy` — без правила движка.
    expect(codes).toContain('token-undefined')
    expect(codes).toContain('safelist-dead')
    expect(report.undefinedTokens).toEqual([{ token: '--nowhere', component: '@x/kit:Card' }])
    expect(report.diagnostics.find(d => d.code === 'safelist-dead')?.subject).toBe('@x/kit:Panel')
    expect(codes).not.toContain('missing-file')
    const text = formatDoctorReport(report)
    expect(text).toContain('✓ OK — no errors')
    expect(text).toContain('[safelist-dead] @x/kit:Panel')
  })

  it('отсутствующий файл и нераскрытый @apply — ошибки; !important и границы — по уровням', async () => {
    const f = fixture({
      cardCss: '.card{@apply p-2;color:red!important}\n',
      cardJs: 'import { readFileSync } from "node:fs"\nimport "@feugene/granum/vite"\nexport const Card = readFileSync\n',
      warnings: [{ code: 'safelist-redundant', component: 'Panel', classes: ['p-4'] }, { code: 'css-double-delivery', component: 'Card', files: ['components/Card/styles.css'] }],
    })
    writeFileSync(join(f.dist, 'theme/tokens.css'), '')
    const report = await granumDoctor(await app(f, { components: ['@x/kit:Panel'] }))
    expect(report.ok).toBe(false)
    const byCode = Object.groupBy(report.diagnostics, d => d.code)
    expect(byCode['apply-not-expanded']?.[0]?.level).toBe('error')
    expect(byCode['important-in-provider-css']?.[0]?.level).toBe('warn')
    expect(byCode.boundary?.map(d => d.message)).toEqual([
      expect.stringContaining('\'@feugene/granum/vite\' (granum-node-entry)'),
      expect.stringContaining('\'node:fs\' (node-import)'),
    ])
    expect(byCode['safelist-redundant']?.[0]?.subject).toBe('@x/kit:Panel')
    expect(byCode['css-double-delivery']?.[0]?.subject).toBe('@x/kit:Card')
    // Ошибки идут первыми.
    const levels = report.diagnostics.map(d => d.level)
    expect(levels.indexOf('warn')).toBeGreaterThan(levels.lastIndexOf('error'))
    expect(formatDoctorReport(report)).toContain('✗ Errors found')
    expect(countDoctorDiagnostics(report).errors).toBe(byCode.boundary!.length + 1)
  })

  it('предупреждение манифеста о невыбранном компоненте не показывается', async () => {
    const f = fixture({ warnings: [{ code: 'safelist-redundant', component: 'Panel', classes: ['p-4'] }] })
    const report = await granumDoctor(await app(f, { components: ['@x/kit:Card'] }))
    expect(report.diagnostics.map(d => d.code)).not.toContain('safelist-redundant')
  })

  it('missing-file — ошибка с путём, провайдер без манифеста и неиспользуемый провайдер — предупреждения', async () => {
    const f = fixture()
    const report = await granumDoctor(await app(f, {
      providers: [f.manifest, { id: '@x/obj', contractVersion: 1, baseUrl: 'file:///obj/', components: [{ name: 'Empty' }] }],
      components: ['@x/kit:Card'],
    }))
    const codes = report.diagnostics.map(d => d.code)
    expect(codes).toContain('provider-without-manifest')
    expect(codes).toContain('unused-provider')
    const g = fixture()
    writeFileSync(join(g.dist, 'components/Card/styles.css'), '')
    const missing = await granumDoctor(await prepareApp({ providers: [{ ...g.manifest, manifest: { ...g.manifest.manifest, components: { ...g.manifest.manifest.components, Card: { ...g.manifest.manifest.components.Card!, css: ['components/Card/gone.css'] } } } }], components: ['@x/kit:Card'] }, g.root))
    expect(missing.ok).toBe(false)
    expect(missing.files.missing).toHaveLength(1)
    expect(missing.diagnostics[0]).toMatchObject({ level: 'error', code: 'missing-file', subject: '@x/kit:Card' })
  })

  it('конфликт токенов и override-skipped читаются из тех же слоёв, что эмиссия (INV-DIAG-1)', async () => {
    const f = fixture()
    const report = await granumDoctor(await app(f, { themes: { tokenOverrides: { light: { 'accent': 'blue', 'not-declared': '1' } }, strictTokens: true } }))
    expect(report.tokenConflicts).toEqual([expect.objectContaining({ theme: 'light', token: 'accent', finalValue: 'blue' })])
    expect(report.diagnostics.map(d => d.code)).toContain('override-skipped')
  })
})

describe('granum explain', () => {
  it('корень селекции, зависимость и невыбранный компонент', async () => {
    const a = await app(fixture())
    const panel = granumExplain(a, 'Panel')
    expect(panel).toMatchObject({ key: '@x/kit:Panel', reason: 'selected', included: true, chain: ['@x/kit:Panel'], dependencies: ['@x/kit:Card'], requiredBy: [] })
    const card = granumExplain(a, '@x/kit:Card')
    expect(card).toMatchObject({ reason: 'dependency', chain: ['@x/kit:Panel', '@x/kit:Card'], requiredBy: ['@x/kit:Panel'], consumes: ['--derived', '--bg', '--nowhere'] })
    expect(card.tokens).toEqual([{ theme: 'light', selector: ':root', tokens: [{ name: 'card-pad', value: 'var(--space)', effective: 'var(--space)', overridden: false }] }])
    expect(card.files).toEqual(['components/Card/index.js'])
    const text = formatExplainReport(card)
    expect(text).toContain('@x/kit:Panel → @x/kit:Card')
    expect(text).toContain('--card-pad: var(--space)')
    const not = granumExplain(await app(fixture(), { components: ['@x/kit:Card'] }), 'Panel')
    expect(not).toMatchObject({ reason: 'not-selected', included: false, chain: [] })
  })

  it('неизвестный компонент: reason=unknown и список известных', () => {
    return app(fixture()).then((a) => {
      const report = granumExplain(a, '@x/kit:Nope')
      expect(report.reason).toBe('unknown')
      expect(report.available).toEqual(['@x/kit:Card', '@x/kit:Panel'])
      expect(formatExplainReport(report)).toContain('Known components (2)')
    })
  })
})

describe('granum why-css (D-3)', () => {
  it('каналы: классы манифеста, safelist, CSS компонента, исходники приложения; правило движка', async () => {
    const a = await app(fixture())
    const p4 = await granumWhyCss(a, 'p-4')
    expect(p4.found).toBe(true)
    expect(p4.hits).toEqual([{ via: 'manifest-classes', component: '@x/kit:Card' }, { via: 'safelist', component: '@x/kit:Panel' }])
    expect(p4.rule?.selector).toBe('.p-4')
    const card = await granumWhyCss(a, 'card')
    expect(card.hits).toEqual([{ via: 'component-css', component: '@x/kit:Card', file: 'components/Card/styles.css' }])
    expect(card.rule).toBeNull()
    const gap = await granumWhyCss(a, 'gap-2')
    expect(gap.hits).toContainEqual({ via: 'app-source', file: 'src/App.vue' })
    const none = await granumWhyCss(a, 'm-99')
    expect(none.found).toBe(false)
    expect(formatWhyCssReport(none)).toContain('No sources found')
    expect(formatWhyCssReport(card)).toContain('Rule: none')
  })
})

describe('granum tokens', () => {
  it('own и deep: объявления, цепочки значений, потребители за пределами scope', async () => {
    const a = await app(fixture(), { themes: { tokenOverrides: { light: { 'card-pad': '4px' } } } })
    const own = granumTokens(a, 'Panel')
    expect(own.components).toEqual(['@x/kit:Panel'])
    expect(own.uses).toEqual([])
    const deep = granumTokens(a, 'Panel', 'deep')
    expect(deep.components).toEqual(['@x/kit:Panel', '@x/kit:Card'])
    expect(deep.declares).toEqual([expect.objectContaining({ token: 'card-pad', declaredBy: '@x/kit:Card', value: 'var(--space)', effective: '4px', overridden: true, unusedInScope: true })])
    const byToken = Object.fromEntries(deep.uses.map(u => [u.token, u]))
    expect(byToken.nowhere?.origin).toBe('none')
    expect(byToken.derived?.origin).toBe('provider')
    expect(byToken.bg?.origin).toBe('provider')
    expect(deep.undefinedCount).toBe(1)
    const text = formatTokensReport(deep)
    expect(text).toContain('--card-pad: var(--space) → 4px (overridden) (unused)')
    expect(text).toContain('--nowhere — defined by no layer')
    const card = granumTokens(a, 'Card')
    expect(card.declares[0]?.layers.map(l => l.source)).toEqual(['component:Card', 'app-override'])
  })

  it('неизвестное имя: unresolved', async () => {
    const report = granumTokens(await app(fixture()), 'Nope')
    expect(report.unresolved).toBe('unknown')
    expect(formatTokensReport(report)).toContain('No provider declares such a component')
  })
})

describe('granum prune', () => {
  it('план совпадает с planTokenPrune, base не режется, размеры считаются', async () => {
    const a = await app(fixture(), { pruneTokens: { mode: 'on' } })
    const report = await granumTokenPrune(a)
    expect(report.mode).toBe('on')
    expect(report.removed).toEqual(['dark-unused', 'unused'])
    expect(report.kept.map(k => k.token)).toEqual(['accent', 'app-only', 'bg', 'card-pad', 'derived', 'nowhere', 'space'])
    expect(report.kept.find(k => k.token === 'accent')?.reason).toEqual({ kind: 'structural' })
    expect(report.kept.find(k => k.token === 'space')?.reason).toEqual({ kind: 'inlined-rule' })
    const base = report.files.find(f => f.kind === 'base')!
    expect(base.skipped).toBe(true)
    expect(base.bytesBefore).toBe(base.bytesAfter)
    const tokens = report.files.find(f => f.kind === 'tokens')!
    expect(tokens).toMatchObject({ declared: 3, kept: 2, removed: 1 })
    expect(tokens.bytesAfter).toBeLessThan(tokens.bytesBefore)
    expect(report.bytesAfter).toBeLessThan(report.bytesBefore)
    const text = formatTokenPruneReport(report, a.root)
    expect(text).toContain('Removed (2): --dark-unused --unused')
    expect(text).toContain('not pruned (base)')
    expect(text).toContain('--space — used by a rule in an inlined file')
  })
})
