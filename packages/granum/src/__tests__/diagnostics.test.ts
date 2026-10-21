import type { GranumConfig } from '../config'
import type { GranumAppTheme } from '../core/resolveThemes'
import type { DoctorDiagnostic, DoctorReport } from '../node/diagnostics/doctor'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ThemeResolutionError } from '../core/errors'
import { countDoctorDiagnostics, formatDoctorReport, formatExplainReport, formatThemeWarning, formatTokenPruneReport, formatTokensReport, formatWhyCssReport, granumDoctor, granumExplain, granumThemes, granumTokenPrune, granumTokens, granumWhyCss } from '../node/diagnostics/index'
import { emitCss } from '../node/emit'
import { buildReport } from '../node/report'
import { catalogProvider, INK, makeManifest, PAPER, prepareTestApp, TEST_ENGINE, themeData } from './helpers'
import { testEngine } from './testEngine'

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
  mkdirSync(join(dist, 'themes'), { recursive: true })
  writeFileSync(join(dist, 'themes/kit.json'), JSON.stringify({ id: 'kit', title: 'Kit', root: { accent: 'red' }, modes: { light: { colorScheme: 'light', tokens: { bg: '#fff' } }, dark: { colorScheme: 'dark', tokens: { 'bg': '#000', 'dark-unused': '1' } } } }))
  writeFileSync(join(dist, 'components/Card/styles.css'), patch.cardCss ?? '.card{padding:var(--derived);background:var(--bg)}\n')
  writeFileSync(join(dist, 'components/Card/index.js'), patch.cardJs ?? 'export const Card = 1\n')
  writeFileSync(join(dist, 'components/Panel/styles.css'), '.panel{display:flex}\n')
  writeFileSync(join(dist, 'components/Panel/index.js'), 'import "../Card/index.js"\nexport const Panel = 2\n')
  writeFileSync(join(root, 'src/App.vue'), '<template><div class="panel-app text-[var(--app-only)] gap-2"/></template>\n')
  const loaded = makeManifest('@x/kit', {
    Card: { classes: ['p-4', 'flex'], css: ['components/Card/styles.css'], tokens: { themes: { kit: { modes: { light: { 'card-pad': 'var(--space)' } } } }, consumes: ['--derived', '--bg', '--nowhere'], dynamic: [] } },
    Panel: { classes: ['gap-2'], css: ['components/Panel/styles.css'], dependencies: ['Card'], safelist: ['p-4', 'shadow-legacy'] },
  }, {
    theme: {
      tokensCss: 'theme/tokens.css',
      baseCss: 'theme/base.css',
      defaultTheme: 'kit',
      catalog: { kit: { title: 'Kit', data: 'themes/kit.json', modes: ['light', 'dark'], defaultMode: 'light' } },
      declares: ['--space', '--unused', '--derived', '--bg', '--dark-unused', '--accent'],
    },
    ...(patch.warnings ? { warnings: patch.warnings } : {}),
  })
  return { root, dist, manifest: { manifest: loaded.manifest, baseUrl: `${pathToFileURL(dist).href}/` } }
}

/** Оба режима фикстуры: без `modes.names` сборка берёт только режим по умолчанию. */
const BOTH = { names: ['light', 'dark'] }

async function app(f: Fixture, config: Partial<GranumConfig> = {}) {
  return prepareTestApp({ providers: [f.manifest], components: ['@x/kit:Panel'], appSources: { dirs: ['src'] }, ...config }, f.root)
}

describe('granum doctor', () => {
  it('динамический токен компонента находкой не считается', async () => {
    // Имя такого токена собирается в рантайме, и статический анализ видит
    // только префикс. Объявление `dynamicTokens` уважает обрезка; доктор обязан
    // уважать его так же, иначе правильно оформленный компонент получает вечную
    // находку, а `--strict` становится непригодным.
    const f = fixture()
    const withDynamic = {
      ...f.manifest,
      manifest: {
        ...f.manifest.manifest,
        components: {
          ...f.manifest.manifest.components,
          Panel: {
            ...f.manifest.manifest.components.Panel!,
            tokens: {
              ...f.manifest.manifest.components.Panel!.tokens,
              consumes: ['--nowhere', '--x-runtime-lane'],
              dynamic: ['--x-runtime-*'],
            },
          },
        },
      },
    }
    const report = await granumDoctor(await prepareTestApp({ providers: [withDynamic], components: ['@x/kit:Panel'] }, f.root))
    const undefinedTokens = report.undefinedTokens.map(entry => entry.token)
    expect(undefinedTokens).toContain('--nowhere')
    expect(undefinedTokens).not.toContain('--x-runtime-lane')
  })

  /**
   * Вердикт выносится по `tokens.requires`, а не по `consumes`: потребление с
   * фолбэком и токен, который компонент присваивает сам, требованием не
   * являются. Считается это на сборке пакета — доктор читает готовое.
   */
  it('находка только по requires; потребление сверх него молчит', async () => {
    const f = fixture()
    const withRequires = {
      ...f.manifest,
      manifest: {
        ...f.manifest.manifest,
        components: {
          ...f.manifest.manifest.components,
          Panel: {
            ...f.manifest.manifest.components.Panel!,
            tokens: {
              ...f.manifest.manifest.components.Panel!.tokens,
              // `--with-fallback` и `--self-assigned` компонент потребляет, но
              // значение у них есть и так: первое в самом `var()`, второе он
              // присваивает сам.
              consumes: ['--really-missing', '--with-fallback', '--self-assigned'],
              requires: ['--really-missing'],
              dynamic: [],
            },
          },
        },
      },
    }
    const report = await granumDoctor(await prepareTestApp({ providers: [withRequires], components: ['@x/kit:Panel'] }, f.root))
    const tokens = report.undefinedTokens.filter(e => e.component === '@x/kit:Panel').map(e => e.token)
    expect(tokens).toEqual(['--really-missing'])
  })

  it('token-fallback-only: токен только с запасным значением, которого не объявил ни один слой и не хук', async () => {
    const f = fixture()
    const card = f.manifest.manifest.components.Card as unknown as { tokens: Record<string, unknown> }
    // `--bg` объявлен темой, `--hook-a` — хук, `--dyn-q` — dynamicTokens, `--un-x` — переменная движка.
    card.tokens = { ...card.tokens, requires: [], optional: ['--bg', '--dyn-q', '--hook-a', '--lost', '--un-x'], hooks: ['--hook-*'], dynamic: ['--dyn-*'] }
    const report = await granumDoctor(await app(f, { themes: [{ theme: 'kit', modes: BOTH }] }))
    const found = report.diagnostics.filter(d => d.code === 'token-fallback-only')
    expect(found.map(d => [d.level, d.subject, d.items])).toEqual([['warn', '@x/kit:Card', ['--lost']]])
    expect(found[0]!.message).toContain('hookTokens')
  })

  it('token-fallback-only: манифест без tokens.optional находки не даёт', async () => {
    const report = await granumDoctor(await app(fixture(), { themes: [{ theme: 'kit', modes: BOTH }] }))
    expect(report.diagnostics.some(d => d.code === 'token-fallback-only')).toBe(false)
  })

  it('манифест без requires проверяется по consumes — старое поведение', async () => {
    const f = fixture()
    const report = await granumDoctor(await prepareTestApp({ providers: [f.manifest], components: ['@x/kit:Panel'] }, f.root))
    // Фикстура объявляет `consumes` и не объявляет `requires`.
    expect(report.undefinedTokens).toEqual([{ token: '--nowhere', component: '@x/kit:Card' }])
  })

  it('чистая конфигурация: ok, предупреждения только по делу', async () => {
    const report = await granumDoctor(await app(fixture()))
    expect(report.ok).toBe(true)
    // Диалект и отпечаток пакета совпали с движком приложения — быстрый путь,
    // классы из манифеста, правил пакет не привозил.
    expect(report.providers).toEqual([{
      id: '@x/kit',
      form: 'manifest',
      version: '0.0.0',
      components: 2,
      hasTheme: true,
      hasEngine: false,
      dialect: TEST_ENGINE.dialect,
      vocabulary: TEST_ENGINE.vocabulary,
      engineName: TEST_ENGINE.name,
      classSource: 'manifest',
      rulesLoaded: false,
    }])
    expect(report.engine).toEqual({ name: TEST_ENGINE.name, dialect: TEST_ENGINE.dialect, vocabulary: TEST_ENGINE.vocabulary })
    expect(report.components.map(c => c.key)).toEqual(['@x/kit:Card', '@x/kit:Panel'])
    expect(report.themes).toMatchObject({ defaultTheme: 'kit', themeSource: 'default', owner: '@x/kit' })
    expect(report.themes.themes.map(theme => `${theme.id}:${theme.default}:${theme.modesSource}`)).toEqual(['kit:true:theme'])
    // Без `modes` — только режим по умолчанию темы.
    expect(report.themes.themes[0]!.modes.map(m => `${m.name}=${m.value}`)).toEqual(['light=kit-light'])
    expect(formatDoctorReport(report)).toContain('Theme: kit (source: defaultTheme of the catalog owner, catalog of @x/kit)')
    expect(formatDoctorReport(report)).toContain('kit (default, main sheet) — modes: [light] (source: default mode of the theme and modes.define)')
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
    // Двойная доставка CSS видна в doctor.
    expect(byCode['css-double-delivery']?.[0]?.subject).toBe('@x/kit:Card')
    // Ошибки идут первыми.
    const levels = report.diagnostics.map(d => d.level)
    expect(levels.indexOf('warn')).toBeGreaterThan(levels.lastIndexOf('error'))
    expect(formatDoctorReport(report)).toContain('✗ Errors found')
    expect(countDoctorDiagnostics(report).errors).toBe(byCode.boundary!.length + 1)
  })

  it('peer-missing: донор и сам granum — разными словами', async () => {
    const f = fixture({ warnings: [{ code: 'peer-missing', provider: '@x/base' }, { code: 'peer-missing', provider: '@feugene/granum' }] })
    const report = await granumDoctor(await app(f, { components: ['@x/kit:Card'] }))
    const messages = report.diagnostics.filter(d => d.code === 'peer-missing').map(d => d.message)
    expect(messages).toEqual([
      expect.stringContaining(`depends on provider '@x/base'`),
      expect.stringContaining(`imports '@feugene/granum' at runtime`),
    ])
  })

  it('тексты предупреждений тем и режимов', () => {
    expect(formatThemeWarning({ kind: 'mode-extends-unresolved', theme: 'kit', mode: 'ocean', base: 'abyss' }))
      .toBe(`modes.define.ocean of theme 'kit' extends "abyss", which is neither a mode of that theme nor a defined mode — it inherits the default mode instead`)
    expect(formatThemeWarning({ kind: 'component-theme-unknown', providerId: '@p/ui', component: 'Chart', theme: 'neon' }))
      .toContain('ships tokens for theme "neon", which no catalog in the graph declares')
  })

  it('предупреждения тем — своими кодами, а не одним общим', async () => {
    const report = await granumDoctor(await app(fixture(), { themes: [{ theme: 'kit', modes: { define: { ocean: { extends: 'abyss' } } } }] }))
    expect(report.diagnostics.find(d => d.code === 'mode-extends-unresolved')?.subject).toBe('kit/ocean')
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
    const missing = await granumDoctor(await prepareTestApp({ providers: [{ ...g.manifest, manifest: { ...g.manifest.manifest, components: { ...g.manifest.manifest.components, Card: { ...g.manifest.manifest.components.Card!, css: ['components/Card/gone.css'] } } } }], components: ['@x/kit:Card'] }, g.root))
    expect(missing.ok).toBe(false)
    expect(missing.files.missing).toHaveLength(1)
    expect(missing.diagnostics[0]).toMatchObject({ level: 'error', code: 'missing-file', subject: '@x/kit:Card' })
  })

  it('конфликт токенов и override-skipped читаются из тех же слоёв, что эмиссия', async () => {
    const f = fixture()
    // Override приложения — намеренное значение, а не конфликт; компонент поверх данных темы — конфликт.
    const card = f.manifest.manifest.components.Card!
    const clash = { ...f.manifest, manifest: { ...f.manifest.manifest, components: { ...f.manifest.manifest.components, Card: { ...card, tokens: { ...card.tokens, themes: { kit: { modes: { light: { bg: '#fefefe' } } } } } } } } }
    const report = await granumDoctor(await app({ ...f, manifest: clash }, { themes: [{ theme: 'kit', modes: { ...BOTH, tokenOverrides: { root: { 'accent': 'blue', 'not-declared': '1' } }, strictTokens: true } }] }))
    // Токен компонента из режима по умолчанию доходит и до тёмного — там он тоже поверх данных темы.
    expect(report.tokenConflicts).toEqual([
      expect.objectContaining({ mode: 'light', token: 'bg', sources: ['theme kit/light', 'component @x/kit:Card (kit/light)'], finalValue: '#fefefe' }),
      expect.objectContaining({ mode: 'dark', token: 'bg', sources: ['theme kit/dark', 'component @x/kit:Card (kit/light)'], finalValue: '#fefefe' }),
    ])
    expect(report.diagnostics.map(d => d.code)).toContain('override-skipped')
  })
})

/**
 * Провайдер, собранный прежней версией granum: в `exports` его пакета есть
 * подпути частей, а манифест их не записал — guard и селекция их не видят.
 */
describe('doctor: части составных компонентов, которых манифест не знает', () => {
  const withExports = (f: Fixture): void => writeFileSync(join(f.root, 'node_modules/@x/kit/package.json'), JSON.stringify({
    name: '@x/kit',
    exports: { './components/Card': './dist/components/Card/index.js', './components/CardItem': './dist/components/Card/index.js' },
  }))

  it('алиас части в exports без записи в манифесте — subcomponents-missing', async () => {
    const f = fixture()
    withExports(f)
    const report = await granumDoctor(await app(f))
    const found = report.diagnostics.filter(d => d.code === 'subcomponents-missing')
    expect(found).toMatchObject([{ level: 'warn', subject: '@x/kit', items: ['CardItem → Card'] }])
  })

  it('манифест знает часть — тишина', async () => {
    const f = fixture()
    withExports(f)
    const { manifest } = f.manifest
    const recorded = { ...f.manifest, manifest: { ...manifest, components: { ...manifest.components, Card: { ...manifest.components.Card!, subcomponents: ['CardItem'] } } } }
    const report = await granumDoctor(await prepareTestApp({ providers: [recorded], components: ['@x/kit:Panel'], appSources: { dirs: ['src'] } }, f.root))
    expect(report.diagnostics.filter(d => d.code === 'subcomponents-missing')).toEqual([])
  })
})

describe('granum explain', () => {
  it('корень селекции, зависимость и невыбранный компонент', async () => {
    const a = await app(fixture(), { themes: [{ theme: 'kit', modes: BOTH }] })
    const panel = granumExplain(a, 'Panel')
    expect(panel).toMatchObject({ key: '@x/kit:Panel', reason: 'selected', included: true, chain: ['@x/kit:Panel'], dependencies: ['@x/kit:Card'], requiredBy: [] })
    const card = granumExplain(a, '@x/kit:Card')
    expect(card).toMatchObject({ reason: 'dependency', chain: ['@x/kit:Panel', '@x/kit:Card'], requiredBy: ['@x/kit:Panel'], consumes: ['--derived', '--bg', '--nowhere'] })
    expect(card.tokens).toEqual([
      { mode: 'light', tokens: [{ name: 'card-pad', value: 'var(--space)', from: 'kit/light', effective: 'var(--space)', overridden: false }] },
      { mode: 'dark', tokens: [{ name: 'card-pad', value: 'var(--space)', from: 'kit/light', effective: 'var(--space)', overridden: false }] },
    ])
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

/**
 * Часть составного компонента живёт в модуле владельца: `explain` и `tokens`
 * по её ключу или имени показывают владельца и называют часть.
 */
describe('часть составного компонента в explain и tokens', () => {
  it('ключ и короткое имя части сводятся к владельцу с пометкой; неоднозначная часть — список', async () => {
    const list = makeManifest('@x/list', { XList: { subcomponents: ['XListItem'] } })
    const a = await prepareTestApp({ providers: [list], components: ['@x/list:XList'] }, mkdtempSync(join(tmpdir(), 'granum-explain-part-')))
    for (const target of ['@x/list:XListItem', 'XListItem']) {
      expect(granumExplain(a, target)).toMatchObject({ key: '@x/list:XList', part: 'XListItem', reason: 'selected', included: true })
      expect(granumTokens(a, target)).toMatchObject({ key: '@x/list:XList', part: 'XListItem', included: true })
    }
    expect(formatExplainReport(granumExplain(a, 'XListItem'))).toContain(`'XListItem' is a part of the compound component @x/list:XList`)
    expect(formatTokensReport(granumTokens(a, 'XListItem'))).toContain(`'XListItem' is a part of the compound component @x/list:XList`)

    const twin = makeManifest('@x/twin', { XGrid: { subcomponents: ['XListItem'] } })
    const b = await prepareTestApp({ providers: [list, twin], components: ['@x/list:XList'] }, mkdtempSync(join(tmpdir(), 'granum-explain-part-')))
    expect(granumExplain(b, 'XListItem')).toMatchObject({ reason: 'unknown', available: ['@x/list:XListItem', '@x/twin:XListItem'] })
  })
})

describe('granum why-css', () => {
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
    const a = await app(fixture(), { themes: [{ theme: 'kit', modes: { ...BOTH, tokenOverrides: { light: { 'card-pad': '4px' } } } }] })
    const own = granumTokens(a, 'Panel')
    expect(own.components).toEqual(['@x/kit:Panel'])
    expect(own.uses).toEqual([])
    const deep = granumTokens(a, 'Panel', 'deep')
    expect(deep.components).toEqual(['@x/kit:Panel', '@x/kit:Card'])
    // Токен компонента из режима по умолчанию доходит и до тёмного; override — только в светлом.
    expect(deep.declares).toEqual([
      expect.objectContaining({ token: 'card-pad', mode: 'dark', from: 'kit/light', declaredBy: '@x/kit:Card', value: 'var(--space)', effective: 'var(--space)', overridden: false, unusedInScope: true }),
      expect.objectContaining({ token: 'card-pad', mode: 'light', from: 'kit/light', value: 'var(--space)', effective: '4px', overridden: true }),
    ])
    const byToken = Object.fromEntries(deep.uses.map(u => [u.token, u]))
    expect(byToken.nowhere?.origin).toBe('none')
    expect(byToken.derived?.origin).toBe('provider')
    expect(byToken.bg?.origin).toBe('theme')
    expect(byToken.bg?.values.map(v => `${v.mode}=${v.effective}`)).toEqual(['light=#fff', 'dark=#000'])
    expect(deep.undefinedCount).toBe(1)
    const text = formatTokensReport(deep)
    expect(text).toContain('[light] --card-pad: var(--space) (from kit/light) → 4px (overridden) (unused)')
    expect(text).toContain('--nowhere — defined by no layer')
    const card = granumTokens(a, 'Card')
    expect(card.declares.find(d => d.mode === 'light')?.layers.map(l => l.source)).toEqual(['component', 'app-override'])
  })

  it('токен только из declares манифеста (другая тема каталога) не объявлен — то же, что у doctor', async () => {
    const f = fixture()
    const theme = f.manifest.manifest.theme as unknown as { declares: string[] }
    theme.declares = [...theme.declares, '--ink-only']
    const card = f.manifest.manifest.components.Card as unknown as { tokens: { consumes: string[] } }
    card.tokens = { ...card.tokens, consumes: [...card.tokens.consumes, '--ink-only'] }
    const a = await app(f, { themes: [{ theme: 'kit', modes: BOTH }] })
    expect(granumTokens(a, 'Card').uses.find(u => u.token === 'ink-only')?.origin).toBe('none')
    expect((await granumDoctor(a)).undefinedTokens.map(u => u.token)).toContain('--ink-only')
  })

  it('неизвестное имя: unresolved', async () => {
    const report = granumTokens(await app(fixture()), 'Nope')
    expect(report.unresolved).toBe('unknown')
    expect(formatTokensReport(report)).toContain('No provider declares such a component')
  })
})

describe('theme-incomplete: полнота тем сборки', () => {
  /** Фикстура с реестром владельца; карточке нужен токен, который дают её токены по темам. */
  function withRegistry(): Fixture {
    const f = fixture()
    writeFileSync(join(f.dist, 'themes/registry.json'), JSON.stringify({ accent: 'root', bg: 'mode' }))
    const card = f.manifest.manifest.components.Card!
    return {
      ...f,
      manifest: {
        ...f.manifest,
        manifest: {
          ...f.manifest.manifest,
          theme: { ...f.manifest.manifest.theme!, registry: 'themes/registry.json' },
          components: { ...f.manifest.manifest.components, Card: { ...card, tokens: { ...card.tokens!, consumes: [...card.tokens!.consumes, '--card-pad'] } } },
        },
      },
    }
  }
  /** Карточке нужны ещё токены — сверх того, что она читает в фикстуре. */
  function requiring(f: Fixture, ...tokens: string[]): Fixture {
    const card = f.manifest.manifest.components.Card!
    const components = { ...f.manifest.manifest.components, Card: { ...card, tokens: { ...card.tokens!, consumes: [...card.tokens!.consumes, ...tokens] } } }
    return { ...f, manifest: { ...f.manifest, manifest: { ...f.manifest.manifest, components } } }
  }
  const sand = (modes: { light: Record<string, string>, dark: Record<string, string> }, root: Record<string, string> = {}, extra: Partial<GranumAppTheme> = {}): GranumAppTheme => ({
    id: 'sand',
    title: 'Sand',
    root,
    defaultMode: 'light',
    modes: { light: { colorScheme: 'light', tokens: modes.light }, dark: { colorScheme: 'dark', tokens: modes.dark } },
    ...extra,
  })
  const doctorOf = async (f: Fixture, extra?: NonNullable<GranumConfig['themes']>[number]) => granumDoctor(await app(f, {
    themes: [{ theme: 'kit', default: true, modes: BOTH }, ...(extra ? [extra] : [])],
  }))
  const incomplete = (report: DoctorReport) => report.diagnostics.filter(d => d.code === 'theme-incomplete')

  it('тема каталога полна — находки нет, покрытие 100 % в отчёте и в выводе', async () => {
    const report = await doctorOf(withRegistry())
    // Реестр (accent, bg) и требование карточки card-pad; --derived даёт tokens.css, --nowhere нет нигде.
    expect(report.themes.themes[0]!.coverage).toEqual({ required: 3, covered: 3 })
    expect(incomplete(report)).toEqual([])
    expect(formatDoctorReport(report)).toContain('coverage 100% (3/3)')
  })

  it('тема-объект без токена реестра и без токенов компонента — доля и список непокрытого', async () => {
    // Литерал, которого нет у режима, берётся из режима по умолчанию (находка
    // theme-mode-missing), поэтому непокрыт здесь bg в самом режиме по умолчанию.
    const report = await doctorOf(withRegistry(), { theme: sand({ light: {}, dark: { bg: '#111' } }, { accent: 'blue' }), modes: ['light', 'dark'] })
    const [finding] = incomplete(report)
    expect(finding?.subject).toBe('sand')
    expect(finding?.message).toContain(`theme 'sand' covers 1 of 3 required token(s) (33%)`)
    expect(finding?.items).toEqual(['light:bg', 'light:card-pad', 'dark:card-pad'])
    expect(report.themes.themes.find(t => t.id === 'sand')?.coverage).toEqual({ required: 3, covered: 1 })
    // Токен, которого нет ни в одной теме, — только token-undefined: одна дыра — одна находка.
    expect(report.diagnostics.some(d => d.code === 'token-undefined' && d.subject.endsWith('--nowhere'))).toBe(true)
    expect(finding?.items?.some(item => item.endsWith(':nowhere'))).toBe(false)
  })

  it('цепочка extends и tokenOverrides закрывают тему — находки нет', async () => {
    const chained = await doctorOf(withRegistry(), { theme: sand({ light: { bg: '#eee' }, dark: { bg: '#111' } }, { accent: 'blue' }, { extends: 'kit' }), modes: ['light', 'dark'] })
    expect(incomplete(chained)).toEqual([])
    const overridden = await doctorOf(withRegistry(), {
      theme: sand({ light: { bg: '#eee' }, dark: {} }, { accent: 'blue' }),
      modes: { names: ['light', 'dark'], tokenOverrides: { dark: { 'bg': '#111', 'card-pad': '2px' }, light: { 'card-pad': '2px' } } },
    })
    expect(incomplete(overridden)).toEqual([])
    expect(overridden.themes.themes.find(t => t.id === 'sand')?.coverage).toEqual({ required: 3, covered: 3 })
  })

  it('без реестра обязательны только требования компонентов', async () => {
    const report = await doctorOf(fixture(), { theme: sand({ light: {}, dark: {} }), modes: ['light', 'dark'] })
    // Требования карточки: --bg есть у kit — его нет у sand; --derived даёт tokens.css.
    expect(incomplete(report)[0]?.items).toEqual(['light:bg', 'dark:bg'])
  })

  it('требование компонента нужно в каждом режиме: значение только в тёмном — находка по светлому', async () => {
    // Селектор режима, под которым компонент читает токен, манифест не знает, а
    // пара другого режима токена не получит: значение задаётся всем режимам.
    const report = await doctorOf(withRegistry(), { theme: sand({ light: { bg: '#eee' }, dark: { 'bg': '#111', 'card-pad': '2px' } }, { accent: 'blue' }), modes: ['light', 'dark'] })
    expect(incomplete(report)[0]?.items).toEqual(['light:card-pad'])
  })

  it('токен реестра, который компонент требует и не задаёт никто, — только token-undefined', async () => {
    const f = withRegistry()
    writeFileSync(join(f.dist, 'themes/registry.json'), JSON.stringify({ accent: 'root', bg: 'mode', nowhere: 'mode' }))
    const report = await doctorOf(f)
    expect(report.diagnostics.some(d => d.code === 'token-undefined' && d.subject.endsWith('--nowhere'))).toBe(true)
    expect(incomplete(report)).toEqual([])
    expect(report.themes.themes[0]!.coverage).toEqual({ required: 3, covered: 3 })
  })

  it('тема без режимов покрыта только своим root', async () => {
    const report = await doctorOf(withRegistry(), { theme: sand({ light: { 'bg': '#eee', 'card-pad': '2px' }, dark: { 'bg': '#111', 'card-pad': '2px' } }), modes: [] })
    expect(incomplete(report)[0]?.items).toEqual(['root:accent', 'root:bg', 'root:card-pad'])
    expect(report.themes.themes.find(t => t.id === 'sand')?.coverage).toEqual({ required: 3, covered: 0 })
  })

  it('токен реестра с природой root нужен в root темы — значения режимов его не заменяют', async () => {
    const both = { 'accent': 'blue', 'bg': '#eee', 'card-pad': '2px' }
    const report = await doctorOf(withRegistry(), { theme: sand({ light: both, dark: both }), modes: ['light', 'dark'] })
    expect(incomplete(report)[0]?.items).toEqual(['root:accent'])
  })

  it('значение во фолбэке режима покрывает этот режим; тема без значения — находка', async () => {
    const supports = 'not (color: color-mix(in oklab, red, red))'
    const mode = (colorScheme: 'light' | 'dark', bg: string) => ({ colorScheme, tokens: { bg, 'card-pad': '2px' }, fallbacks: [{ supports, tokens: { fb: '1px' } }] })
    const theme = sand({ light: {}, dark: {} }, { accent: 'blue' }, { modes: { light: mode('light', '#eee'), dark: mode('dark', '#111') } })
    const report = await doctorOf(requiring(withRegistry(), '--fb'), { theme, modes: ['light', 'dark'] })
    expect(report.diagnostics.some(d => d.code === 'token-undefined' && d.subject.endsWith('--fb'))).toBe(false)
    expect(incomplete(report).map(d => [d.subject, d.items])).toEqual([['kit', ['light:fb', 'dark:fb']]])
  })

  it('порядок непокрытого — по кодовым единицам, а не по локали', async () => {
    const f = fixture()
    writeFileSync(join(f.dist, 'themes/registry.json'), JSON.stringify({ 'alpha': 'mode', 'Zeta-x': 'mode' }))
    const withOwnRegistry = { ...f, manifest: { ...f.manifest, manifest: { ...f.manifest.manifest, theme: { ...f.manifest.manifest.theme!, registry: 'themes/registry.json' } } } }
    const report = await doctorOf(withOwnRegistry)
    expect(incomplete(report)[0]?.items).toEqual(['light:Zeta-x', 'dark:Zeta-x', 'light:alpha', 'dark:alpha'])
  })

  it('невалидный реестр — registry-invalid, а не отсутствующий файл', async () => {
    const f = withRegistry()
    writeFileSync(join(f.dist, 'themes/registry.json'), JSON.stringify({ '--accent': 'root' }))
    const report = await doctorOf(f)
    expect(report.diagnostics.find(d => d.code === 'registry-invalid')?.level).toBe('error')
    expect(report.diagnostics.some(d => d.code === 'missing-file')).toBe(false)
    expect(report.files.missing).toEqual([])
  })

  it('находка говорит, откуда элемент под парой берёт недостающий токен', async () => {
    const report = await doctorOf(withRegistry(), { theme: sand({ light: {}, dark: {} }, { accent: 'blue' }), modes: ['light', 'dark'] })
    expect(incomplete(report)[0]?.message).toContain('from another theme')
  })
})

describe('token-undefined: доктор и отчёт сборки', () => {
  it('одно множество: только то, что требуют компоненты, без dynamicTokens и без разметки приложения', async () => {
    const f = fixture()
    // `--dyn-x` объявлен компонентом как собираемый в рантайме; `--app-only`
    // потребляет разметка приложения (`App.vue` фикстуры) — его дело.
    const card = f.manifest.manifest.components.Card as unknown as { tokens: { consumes: string[], dynamic: string[] } }
    card.tokens = { ...card.tokens, consumes: [...card.tokens.consumes, '--dyn-x'], dynamic: ['--dyn-*'] }
    const a = await app(f)
    const doctor = await granumDoctor(a)
    const report = buildReport(a, await emitCss(a))

    expect(report.tokens.undefined).toEqual([...new Set(doctor.undefinedTokens.map(u => u.token))].sort())
    expect(report.tokens.undefined).toEqual(['--nowhere'])
  })
})

describe('granum prune', () => {
  it('токен из вывода движка сохраняется по той же причине, что в сборке', async () => {
    const engine = testEngine({ vocabulary: TEST_ENGINE.vocabulary, extra: { 'gap-2': 'gap:var(--unused);' } })
    const a = await app(fixture(), { pruneTokens: { mode: 'on' }, engine, themes: [{ theme: 'kit', modes: BOTH }] })
    const report = await granumTokenPrune(a)
    // Данные темы и токены компонентов — пакетный слой: никем не потребляемые режутся.
    expect(report.removed).toEqual(['accent', 'card-pad', 'dark-unused'])
    expect(report.kept.find(k => k.token === 'unused')?.reason).toEqual({ kind: 'engine-css' })
    expect(formatTokenPruneReport(report, a.root)).toContain('--unused — used by engine utilities or preflight')
  })

  it('план совпадает с planTokenPrune, base не режется, размеры считаются', async () => {
    const a = await app(fixture(), { pruneTokens: { mode: 'on' }, themes: [{ theme: 'kit', modes: BOTH }] })
    const report = await granumTokenPrune(a)
    expect(report.mode).toBe('on')
    expect(report.removed).toEqual(['accent', 'card-pad', 'dark-unused', 'unused'])
    expect(report.kept.map(k => k.token)).toEqual(['app-only', 'bg', 'derived', 'nowhere', 'space'])
    expect(report.kept.find(k => k.token === 'bg')?.reason).toEqual({ kind: 'usage' })
    expect(report.kept.find(k => k.token === 'space')?.reason).toEqual({ kind: 'inlined-rule' })
    const base = report.files.find(f => f.kind === 'base')!
    expect(base.skipped).toBe(true)
    expect(base.bytesBefore).toBe(base.bytesAfter)
    const tokens = report.files.find(f => f.kind === 'tokens')!
    expect(tokens).toMatchObject({ declared: 3, kept: 2, removed: 1 })
    expect(tokens.bytesAfter).toBeLessThan(tokens.bytesBefore)
    expect(report.bytesAfter).toBeLessThan(report.bytesBefore)
    const text = formatTokenPruneReport(report, a.root)
    expect(text).toContain('Removed (4): --accent --card-pad --dark-unused --unused')
    expect(text).toContain('not pruned (base)')
    expect(text).toContain('--space — used by a rule in an inlined file')
  })
})

describe('formatDoctorReport: сводка и детали по требованию', () => {
  /** Отчёт с заданным числом предупреждений одного кода: проверяем свёртку. */
  function reportWith(warnCount: number, extra: DoctorDiagnostic[] = []): DoctorReport {
    const noisy: DoctorDiagnostic[] = Array.from({ length: warnCount }, (_, i) => ({
      level: 'warn' as const,
      code: 'safelist-redundant' as const,
      subject: `@x/kit:C${i}`,
      message: 'safelist duplicates statically extracted classes',
      items: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
    }))
    return {
      engine: { name: 'e', dialect: 'x/y@1', vocabulary: 'fnv64-0' },
      providers: [],
      components: Array.from({ length: 30 }, (_, i) => ({
        key: `@x/kit:C${i}`,
        providerId: '@x/kit',
        name: `C${i}`,
        dependencies: [],
        classes: 2,
        safelist: 1,
        css: 0,
      })),
      themes: { defaultTheme: 'kit', themeSource: 'default', owner: '@x/kit', themes: [{ id: 'kit', default: true, modes: [], modesSource: 'theme' }], warnings: [] },
      tokenConflicts: [],
      undefinedTokens: [],
      files: { checked: 1, missing: [] },
      diagnostics: [...noisy, ...extra],
      ok: extra.every(d => d.level !== 'error'),
    } as unknown as DoctorReport
  }

  it('покрытие темы — доля вниз без ошибки округления; отчёт без покрытия читается', () => {
    const report = reportWith(0)
    const kit = { ...report.themes.themes[0]!, coverage: { required: 50, covered: 29 } }
    expect(formatDoctorReport({ ...report, themes: { ...report.themes, themes: [kit] } })).toContain('coverage 58% (29/50)')
    expect(formatDoctorReport(report)).not.toContain('coverage')
  })

  it('много предупреждений — таблица по кодам с числами и подсказкой флага', () => {
    const text = formatDoctorReport(reportWith(70))
    expect(text).toContain('Diagnostics (errors: 0, warnings: 70):')
    expect(text).toContain('safelist-redundant')
    expect(text).toContain('--code=safelist-redundant')
    // Ни одной построчной находки: 70 строк — это и есть нечитаемый вывод.
    expect(text).not.toContain('@x/kit:C0 —')
    // Список компонентов свёрнут, суммы на месте.
    expect(text).toContain('--components to expand')
    expect(text).toContain('classes 60, safelist 30')
  })

  it('мало предупреждений — печатаются построчно, перечисление свёрнуто в счётчик', () => {
    const text = formatDoctorReport(reportWith(2))
    expect(text).toContain('[safelist-redundant] @x/kit:C0 — safelist duplicates statically extracted classes (5): p-1 p-2 p-3 … +2')
  })

  it('ошибки печатаются целиком и первыми, сколько бы ни было предупреждений', () => {
    const text = formatDoctorReport(reportWith(70, [{
      level: 'error',
      code: 'missing-file',
      subject: '@x/kit (theme)',
      message: 'file is missing: /nope.css',
    }]))
    const errorAt = text.indexOf('[missing-file]')
    const tableAt = text.indexOf('--code=safelist-redundant')
    expect(errorAt).toBeGreaterThan(-1)
    expect(errorAt).toBeLessThan(tableAt)
  })

  it('--code разворачивает один код целиком, с перечислением', () => {
    const text = formatDoctorReport(reportWith(70), { code: 'safelist-redundant' })
    expect(text).toContain('Diagnostics for code safelist-redundant (70 of 70):')
    expect(text).toContain('p-1 p-2 p-3 p-4 p-5')
  })

  it('--component сужает и находки, и список компонентов', () => {
    const text = formatDoctorReport(reportWith(70), { component: '@x/kit:C3' })
    expect(text).toContain('Selected components (1,')
    expect(text).toContain('Diagnostics for component @x/kit:C3 (1 of 70):')
    expect(text).not.toContain('@x/kit:C4 —')
  })

  it('--components разворачивает список без фильтра находок', () => {
    const text = formatDoctorReport(reportWith(70), { components: true })
    expect(text).toContain('• @x/kit:C29 —')
    expect(text).toContain('--code=safelist-redundant')
  })
})

describe('doctor: режим без файла у компонента', () => {
  const card = (modes: Record<string, Record<string, string>>) => ({ Card: { themes: { paper: { modes } } } })

  it('литералы компонента для dark взяты из light — предупреждение с именами токенов', async () => {
    const { root, provider } = catalogProvider({ components: card({ light: { 'c-shade': '#fff', 'c-edge': '#eee' } }) })
    const report = await granumDoctor(await prepareTestApp({ providers: [provider], themes: [{ theme: 'paper', modes: { names: ['light', 'dark'], define: { ocean: { extends: 'dark' } } } }] }, root))
    const found = report.diagnostics.filter(d => d.code === 'component-mode-missing')
    // Один раз на режим темы: `ocean` наследует `dark` и повторно не считается.
    expect(found.map(d => [d.subject, d.items])).toEqual([['@p/ds:Card', ['--c-edge', '--c-shade']]])
    expect(found[0]!.message).toContain(`mode 'dark'`)
  })

  it('файл режима есть, значение — формула или режим один — молчит', async () => {
    const both = catalogProvider({ components: card({ light: { 'c-shade': '#fff' }, dark: { 'c-shade': '#000' } }) })
    const ok = await granumDoctor(await prepareTestApp({ providers: [both.provider], themes: [{ theme: 'paper', modes: { names: ['light', 'dark'] } }] }, both.root))
    expect(ok.diagnostics.some(d => d.code === 'component-mode-missing')).toBe(false)

    // Формула через роль одинакова во всех режимах и сама следует их ролям.
    const formula = catalogProvider({ components: card({ light: { 'c-shade': 'var(--p-bg)' } }) })
    const shared = await granumDoctor(await prepareTestApp({ providers: [formula.provider], themes: [{ theme: 'paper', modes: { names: ['light', 'dark'] } }] }, formula.root))
    expect(shared.diagnostics.some(d => d.code === 'component-mode-missing')).toBe(false)

    const lightOnly = catalogProvider({ components: card({ light: { 'c-shade': '#fff' } }) })
    const single = await granumDoctor(await prepareTestApp({ providers: [lightOnly.provider] }, lightOnly.root))
    expect(single.diagnostics.some(d => d.code === 'component-mode-missing')).toBe(false)
  })
})

describe('doctor: режим без значения в данных темы', () => {
  const findings = async (theme: ReturnType<typeof themeData>, names: string[], define?: Record<string, { extends: string }>): Promise<[string, readonly string[] | undefined][]> => {
    const { root, provider } = catalogProvider({ themes: { t: theme } })
    const report = await granumDoctor(await prepareTestApp({ providers: [provider], themes: [{ theme: 't', modes: { names, ...(define ? { define } : {}) } }] }, root))
    return report.diagnostics.filter(d => d.code === 'theme-mode-missing').map(d => [d.subject, d.items])
  }

  it('литералы данных темы для dark взяты из light — предупреждение с именами токенов', async () => {
    const theme = themeData('t', { light: { 'p-bg': '#fff', 'p-edge': '#eee', 'p-fg': '#111' }, dark: { 'p-fg': '#eee' } })
    // `ocean` — копия `dark` и повторно не считается.
    expect(await findings(theme, ['light', 'dark', 'ocean'], { ocean: { extends: 'dark' } })).toEqual([['t/dark', ['--p-bg', '--p-edge']]])
  })

  it('режим без значения по всей цепочке extends — находка и у наследника', async () => {
    const theme = themeData('t', {
      light: { 'p-bg': '#fff', 'p-fg': '#111' },
      dark: { 'p-fg': '#eee' },
      dim: { colorScheme: 'dark', extends: 'dark', tokens: { 'p-fg': '#ccc' } },
    })
    expect(await findings(theme, ['light', 'dark', 'dim'])).toEqual([['t/dark', ['--p-bg']], ['t/dim', ['--p-bg']]])
  })

  it('значение в каждом режиме, формула, наследник режима по умолчанию или режим один — молчит', async () => {
    expect(await findings(themeData('t', { light: { 'p-bg': '#fff' }, dark: { 'p-bg': '#000' } }), ['light', 'dark'])).toEqual([])
    // Формула через роль сама следует ролям режима.
    expect(await findings(themeData('t', { light: { 'p-bg': '#fff', 'p-soft': 'var(--p-bg)' }, dark: { 'p-bg': '#000' } }), ['light', 'dark'])).toEqual([])
    // Режим, наследующий режим по умолчанию, берёт его значения по своей цепочке.
    expect(await findings(themeData('t', { light: { 'p-bg': '#fff', 'p-fg': '#111' }, sepia: { colorScheme: 'light', extends: 'light', tokens: { 'p-bg': '#f4ecd8' } } }), ['light', 'sepia'])).toEqual([])
    expect(await findings(themeData('t', { light: { 'p-bg': '#fff' }, dark: { 'p-fg': '#eee' } }), ['light'])).toEqual([])
  })

  it('значение, которое режиму дал токен компонента, находкой не считается', async () => {
    const theme = themeData('t', { light: { 'p-bg': '#fff', 'p-edge': '#eee' }, dark: {} })
    const { root, provider } = catalogProvider({ themes: { t: theme }, components: { Card: { themes: { t: { modes: { dark: { 'p-bg': '#000' } } } } } } })
    const report = await granumDoctor(await prepareTestApp({ providers: [provider], themes: [{ theme: 't', modes: { names: ['light', 'dark'] } }] }, root))
    expect(report.diagnostics.filter(d => d.code === 'theme-mode-missing').map(d => d.items)).toEqual([['--p-edge']])
  })
})

describe('doctor: значения темы и её целевые пакеты (A-37, A-38, D-2, D-10)', () => {
  it('выход за targets, чужой токен и неизвестный компонент — находки; блок тем печатает версию и targets', async () => {
    const theme = themeData('t', { light: { 'p-bg': '#fff', 'c-shade': '#eee' } }, {
      version: '1.2.0',
      targets: { '@p/ds': '^1.0.0', '@p/absent': '^1.0.0' },
      components: { '@p/ds': { Card: { modes: { light: { 'c-glow': 'none' } } }, Ghost: { root: { 'g-x': '1px' } } } },
    })
    const { root, provider } = catalogProvider({
      themes: { t: theme },
      components: { Card: { tokens: { consumes: ['--c-shade', '--c-glow'], requires: [], optional: ['--c-shade', '--c-glow'], hooks: ['--c-shade', '--c-glow'], dynamic: [] } } },
    })
    const report = await granumDoctor(await prepareTestApp({ providers: [provider], themes: ['t'] }, root))
    const codes = (code: string) => report.diagnostics.filter(d => d.code === code).map(d => d.subject)
    expect(codes('theme-target-mismatch')).toEqual(['t → @p/ds'])
    // `c-glow` — хук в разделе, `c-shade` — хук в режиме темы: по находке на токен.
    expect(codes('theme-token-foreign')).toEqual(['t → @p/ds:Card', 't → @p/ds:Card'])
    expect(codes('theme-component-unknown')).toEqual(['t → @p/ds:Ghost'])
    expect(report.themes.themes[0]).toMatchObject({
      version: '1.2.0',
      targets: [
        { providerId: '@p/ds', range: '^1.0.0', version: '0.0.0', status: 'mismatch' },
        { providerId: '@p/absent', range: '^1.0.0', status: 'absent' },
      ],
    })
    const text = formatDoctorReport(report)
    expect(text).toContain('t 1.2.0 (default, main sheet)')
    expect(text).toContain('targets: @p/ds ^1.0.0 ✗ 0.0.0, @p/absent ^1.0.0 (not in the graph)')
  })
})

describe('дополнительные темы в диагностике', () => {
  it('конфликт режимонезависимого токена дополнительной темы назван как токены темы, а не режим', async () => {
    const { root, provider } = catalogProvider({ components: { Card: { themes: { ink: { root: { 'p-radius': '1px' }, modes: {} } } } } })
    const report = await granumDoctor(await prepareTestApp({ providers: [provider], themes: [{ theme: 'paper', default: true }, 'ink'] }, root))
    const conflict = report.diagnostics.find(d => d.code === 'token-conflict' && d.subject.endsWith(':p-radius'))
    expect(conflict?.message).toContain(`the mode-independent tokens of theme 'ink'`)
    expect(conflict?.message).not.toContain(`mode 'ink/root'`)
  })

  it('granum themes выбирает основную тему той же функцией, что резолвер: без пометки или с двумя — ошибка', async () => {
    const { root, provider } = catalogProvider()
    const config = (themes: GranumConfig['themes']): GranumConfig => ({ providers: [provider], engine: TEST_ENGINE, themes } as GranumConfig)
    expect(granumThemes(config([{ theme: 'paper', default: true }, 'ink']), root).main).toBe('paper')
    expect(() => granumThemes(config(['paper', 'ink']), root)).toThrow(ThemeResolutionError)
    expect(() => granumThemes(config([{ theme: 'paper', default: true }, { theme: 'ink', default: true }]), root)).toThrow(/exactly one goes under/)
  })

  it('theme-base-global: правила стиля в baseCss дополнительной темы действуют на всю страницу — находка', async () => {
    const font = '@font-face { font-family: Ink; src: url(ink.woff2); }'
    const { root, provider } = catalogProvider({
      themes: { paper: { ...PAPER, baseCss: ['body { font-family: Paper }', 'html { color: black }'] }, ink: { ...INK, extends: 'paper', baseCss: [font, 'html { color: black }', 'body { font-family: Ink }', '@media print { .x { color: red } }'] } },
    })
    const report = await granumDoctor(await prepareTestApp({ providers: [provider], themes: [{ theme: 'paper', default: true }, 'ink'] }, root))
    const found = report.diagnostics.filter(d => d.code === 'theme-base-global')
    // У основной темы база общая по определению — находки нет; запись, которую
    // дополнительная тема делит с основной, лежит в общем листе — тоже.
    expect(found.map(d => [d.level, d.subject, d.items])).toEqual([['warn', 'ink', ['body', '@media print']]])
  })
})
