import type { GranumManifest, GranumProvider } from '../contract'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { granumProvider } from '../build/plugin'
import { defineGranumComponent, defineGranumProvider } from '../contract'
import { BoundaryViolationError, CssReadError, EngineDialectMismatchError, PackageExportsError, UndeclaredDependencyError } from '../core/errors'
import { collectImportSpecifiers } from '../node/imports'
import { readManifestSync } from '../node/manifest'
import { TEST_DIALECT, testEngine } from './testEngine'

/**
 * Интеграция плагина с настоящим Vite (B-1…B-17): временный провайдер из двух
 * компонентов, темы и объявленного CSS собирается программным `build()`, а
 * манифест читается штатным читателем.
 */
interface Fixture {
  root: string
  provider: GranumProvider
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}

function makeFixture(options: {
  declareDependency?: boolean
  exportsOk?: boolean
  nodeImport?: boolean
  brokenCss?: boolean
  engineRules?: boolean
  /** Пакет без утилит вовсе: ни классов, ни safelist — только свой CSS. */
  plain?: boolean
  /** Поле выбора файла в шаблоне Card: `accept="image/*"` уезжает в чанк строкой. */
  fileInput?: boolean
  /** `<style>` в SFC Panel рядом с объявленным `cssFiles: ['./styles.css']` — раскладка из руководства. */
  panelStyle?: boolean
  /** Пути темы с `./` — так их пишут руками; в манифест они обязаны уехать нормализованными. */
  dotPaths?: boolean
  /** `v-bind()` в `<style>` Card: Vue выставляет переменную сам, через `useCssVars`. */
  vbind?: boolean
  /** Дескрипторы в `config.ts` и реэкспорт из entry компонента — как фикстура heavy и ядро granularity. */
  runtimeConfig?: boolean
  /** Реэкспорт из другой точки входа granum в корне пакета — рантайм-зависимость от granum. */
  runtimeImport?: boolean
  /** Поля `package.json` поверх стандартных (`peerDependencies` и т.п.). */
  packageJson?: Record<string, unknown>
} = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'granum-build-'))
  const { declareDependency = true, exportsOk = true, nodeImport = false, brokenCss = false, engineRules = false, plain = false, fileInput = false, panelStyle = false, dotPaths = false, vbind = false, runtimeConfig = false, runtimeImport = false, packageJson = {} } = options
  const at = dotPaths ? './' : ''
  const input = fileInput ? '<input type="file" accept="image/*" class="sr-only">' : ''

  write(root, 'package.json', JSON.stringify({
    name: '@t/kit',
    version: '1.2.3',
    type: 'module',
    exports: exportsOk
      ? { '.': './dist/index.js', './granum.manifest.json': './dist/granum.manifest.json', './components/Card': './dist/components/Card/index.js', './components/Panel': './dist/components/Panel/index.js' }
      : { '.': './dist/index.js' },
    ...packageJson,
  }))
  write(root, 'src/index.ts', `export * from './components/Card/index.ts'\nexport * from './components/Panel/index.ts'\n${runtimeImport ? `export { createThemeController } from '@feugene/granum/runtime'\n` : ''}`)
  write(root, 'src/theme/tokens.css', ':root{--t-space:8px;--t-bg:#fff}\n@supports (x:1){:root{--t-fallback:1}}')
  write(root, 'src/theme/dark.css', '.dark{--t-bg:#000}')
  write(root, 'src/components/Card/Card.vue', plain
    ? `<script setup lang="ts"></script>\n<template><div class="t-card"><slot /></div></template>\n<style>.t-card{gap:var(--t-space);}</style>\n`
    : `<script setup lang="ts">${nodeImport ? `import { readFileSync } from 'node:fs'; void readFileSync` : ''}${vbind ? `const color = 'red'` : ''}</script>\n<template>${input}<div class="t-card p-4 bg-[var(--t-bg)]"><slot /></div></template>\n<style>.t-card{gap:var(--t-space);@apply font-bold;${vbind ? 'color:v-bind(color);' : ''}}</style>\n`)
  write(root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\n${runtimeConfig ? `export { cardConfig } from './config.ts'\n` : ''}`)
  if (runtimeConfig)
    write(root, 'src/components/Card/config.ts', `import { defineGranumComponent } from '@feugene/granum/contract'\nexport const cardConfig = defineGranumComponent(import.meta.url, { name: 'Card', cssFiles: ['./card.css'], tokenDefinitionsRef: { light: './light.css' } })\n`)
  write(root, 'src/components/Panel/Panel.vue', plain
    ? `<script setup lang="ts">\nimport { Card } from '../Card/index.ts'\n</script>\n<template><section class="t-panel"><Card /></section></template>\n`
    : `<script setup lang="ts">\nimport { Card } from '../Card/index.ts'\nconst z = '--t-z'\n</script>\n<template><section class="flex gap-2" :style="{ zIndex: 'var(' + z + ')' }"><Card /><!-- p-9 --></section></template>\n${panelStyle ? '<style>.t-panel-sfc{margin:var(--t-gap)}</style>\n' : ''}`)
  write(root, 'src/components/Panel/index.ts', `export { default as Panel } from './Panel.vue'\n${runtimeConfig ? `export { panelConfig } from './config.ts'\n` : ''}`)
  if (runtimeConfig)
    write(root, 'src/components/Panel/config.ts', `import { defineGranumComponent } from '@feugene/granum/contract'\nexport const panelConfig = defineGranumComponent(import.meta.url, { name: 'Panel', dependencies: ['Card'] })\n`)
  if (!brokenCss)
    write(root, 'src/components/Panel/styles.css', '.t-panel{color:var(--t-fg, red)}\n')

  const card = defineGranumComponent(pathToFileURL(join(root, 'src/components/Card/config.ts')).href, { name: 'Card', ...(plain ? {} : { safelist: ['p-4', 'shadow-legacy'] }) })
  const panel = defineGranumComponent(pathToFileURL(join(root, 'src/components/Panel/config.ts')).href, {
    name: 'Panel',
    ...(declareDependency ? { dependencies: ['Card'] } : {}),
    cssFiles: ['./styles.css'],
    dynamicTokens: ['t-z'],
  })
  const provider = defineGranumProvider({
    id: '@t/kit',
    contractVersion: 1,
    components: [card, panel],
    theme: { tokensCss: `${at}theme/tokens.css`, themes: { dark: `${at}theme/dark.css` }, defaultThemes: ['light'] },
    ...(engineRules ? { engine: { dialect: TEST_DIALECT, rules: [['kit-reset', { appearance: 'none' }] as const] } } : {}),
  })
  return { root, provider }
}

/**
 * Провайдер с группой `g`: `GA` и `GB` используют общий `shared/S.vue`, а тот
 * импортирует часть `GB`. У `S` и `GB/parts/Item.vue` один набор зависящих
 * entry, бандлер кладёт их в один чанк, и чанк называется по группе.
 */
function groupFixture(options: { declareDependency?: boolean } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'granum-group-'))
  write(root, 'package.json', JSON.stringify({
    name: '@t/grp',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './dist/index.js', './granum.manifest.json': './dist/granum.manifest.json', './components/GA': './dist/components/GA/index.js', './components/GB': './dist/components/GB/index.js' },
  }))
  write(root, 'src/index.ts', `export * from './components/g/GA/index.ts'\nexport * from './components/g/GB/index.ts'\n`)
  write(root, 'src/components/g/shared/S.vue', `<script setup lang="ts">\nimport Item from '../GB/parts/Item.vue'\n</script>\n<template><header class="p-2"><Item /></header></template>\n`)
  write(root, 'src/components/g/GB/parts/Item.vue', `<template><span class="p-3">item</span></template>\n`)
  write(root, 'src/components/g/GA/GA.vue', `<script setup lang="ts">\nimport S from '../shared/S.vue'\n</script>\n<template><div class="p-4"><S /></div></template>\n`)
  write(root, 'src/components/g/GB/GB.vue', `<script setup lang="ts">\nimport S from '../shared/S.vue'\nimport Item from './parts/Item.vue'\n</script>\n<template><div class="p-5"><S /><Item /></div></template>\n`)
  write(root, 'src/components/g/GA/index.ts', `export { default as GA } from './GA.vue'\n`)
  write(root, 'src/components/g/GB/index.ts', `export { default as GB } from './GB.vue'\n`)
  const ga = defineGranumComponent(pathToFileURL(join(root, 'src/components/g/GA/config.ts')).href, { name: 'GA', group: 'g', ...(options.declareDependency ? { dependencies: ['GB'] } : {}) })
  const gb = defineGranumComponent(pathToFileURL(join(root, 'src/components/g/GB/config.ts')).href, { name: 'GB', group: 'g' })
  const provider = defineGranumProvider({ id: '@t/grp', contractVersion: 1, components: [ga, gb], theme: { themes: {}, defaultThemes: [] } })
  return { root, provider }
}

async function run(
  fixture: Fixture,
  pluginOptions: Partial<Parameters<typeof granumProvider>[0]> = {},
  extraPlugins: unknown[] = [],
): Promise<{ manifest: GranumManifest, dist: string, logs: string[] }> {
  const logs: string[] = []
  await build({
    root: fixture.root,
    configFile: false,
    logLevel: 'silent',
    plugins: [vue(), granumProvider({ provider: fixture.provider, engine: testEngine(), log: l => logs.push(l), ...pluginOptions }), ...extraPlugins] as never,
    build: { minify: false, rolldownOptions: { external: ['vue'] } },
  })
  const dist = join(fixture.root, 'dist')
  return { manifest: readManifestSync(join(dist, 'granum.manifest.json')).manifest, dist, logs }
}

describe('granumProvider с настоящим Vite', () => {
  it('правила движка без engineModule — предупреждение, а не тихая потеря (M-7)', async () => {
    // Правила известны сборке (классы провайдера ими извлекаются), но манифест
    // ссылается на модуль, и без пути приложение их не получит.
    const { manifest, logs } = await run(makeFixture({ engineRules: true }))

    expect(manifest.engine.module).toBeNull()
    expect(manifest.warnings.map(w => w.code)).toContain('engine-module-missing')
    expect(logs.some(line => line.includes('engineModule') && line.includes('warning'))).toBe(true)

    // С переданным путём предупреждения нет, а путь уезжает в манифест.
    const withModule = await run(makeFixture({ engineRules: true }), { engineModule: 'engine.js' })
    expect(withModule.manifest.engine.module).toBe('engine.js')
    expect(withModule.manifest.warnings.map(w => w.code)).not.toContain('engine-module-missing')
  })

  it('нарушение границы не переезжает в следующую сборку того же инстанса (B-15)', async () => {
    /*
     * Состояние границы, собранное в одной сборке, не имеет права дожить до
     * следующей: `transform` при пересборке идёт только по изменённым модулям,
     * и старое нарушение продолжало бы ронять сборку после починки кода.
     *
     * Гарантию даёт сброс в `buildStart` — он вызывается на каждую сборку,
     * включая пересборку в `vite build --watch`, где `configResolved` за всю
     * сессию срабатывает один раз. Этот тест сторожит изоляцию между двумя
     * `build()` и сам watch-сессию не воспроизводит: программный `build()`
     * зовёт `configResolved` каждый раз, поэтому зелёным он был бы и со
     * сбросом в прежнем месте. Настоящая сессия — в `buildWatch.test.ts`.
     */
    const fixture = makeFixture({ nodeImport: true })
    const logs: string[] = []
    const plugin = granumProvider({ provider: fixture.provider, engine: testEngine(), boundaryCheck: 'warn', log: l => logs.push(l) })
    const rebuild = async (): Promise<void> => {
      await build({
        root: fixture.root,
        configFile: false,
        logLevel: 'silent',
        plugins: [vue(), plugin],
        build: { minify: false, rolldownOptions: { external: ['vue'] } },
      })
    }

    await rebuild()
    expect(logs.some(line => line.includes('node:fs'))).toBe(true)

    // Починка: тот же файл без node-импорта, тот же инстанс плагина.
    write(fixture.root, 'src/components/Card/Card.vue', `<script setup lang="ts"></script>\n<template><div class="t-card p-4 bg-[var(--t-bg)]"><slot /></div></template>\n<style>.t-card{gap:var(--t-space);@apply font-bold;}</style>\n`)
    logs.length = 0
    await rebuild()

    expect(logs.filter(line => line.includes('node:fs'))).toEqual([])
  })

  it('движок артефакта — факт: блок engine и отказ приписать чужой словарь (INV-ENG-10, M-E5)', async () => {
    const engine = testEngine()
    const { manifest } = await run(makeFixture())
    expect(manifest.engine).toEqual({ dialect: engine.dialect, vocabulary: engine.vocabulary, name: engine.name, module: null })

    // Провайдер утверждает один словарь, а собирают его другим — записать в
    // манифест чужой диалект нельзя. Падает на создании плагина, до первого
    // хука: раньше некуда (INV-ERR-1).
    const provider = { ...makeFixture().provider, engine: { dialect: 'other/atoms@1' } }
    expect(() => granumProvider({ provider, engine, log: () => {} })).toThrow(EngineDialectMismatchError)
  })

  it('пакет без утилит получает dialect: null (E-3, M-E5)', async () => {
    // Компонент без классов и без safelist ни от какого словаря не зависит:
    // писать в манифест диалект было бы догадкой, а не фактом.
    const plain = makeFixture({ plain: true })
    const { manifest } = await run(plain)
    expect(Object.values(manifest.components).every(c => c.classes.length === 0 && c.safelist.length === 0)).toBe(true)
    expect(manifest.engine.dialect).toBeNull()
    expect(manifest.engine.vocabulary).toBeNull()
  })

  it('провайдер без правил движка предупреждения не получает', async () => {
    const { manifest } = await run(makeFixture())

    expect(manifest.engine.module).toBeNull()
    expect(manifest.warnings.map(w => w.code)).not.toContain('engine-module-missing')
  })

  it('раскладка, манифест, классы, токены, копии CSS, @apply, exports (B-1…B-14)', async () => {
    const { manifest, dist, logs } = await run(makeFixture())

    expect(manifest.id).toBe('@t/kit')
    expect(manifest.version).toBe('1.2.3')
    expect(Object.keys(manifest.components)).toEqual(['Card', 'Panel'])

    const card = manifest.components.Card!
    expect(card.entry).toBe('components/Card/index.js')
    expect(card.classes).toEqual(['bg-[var(--t-bg)]', 'p-4'])
    // `p-4` объявлен в safelist и найден извлечением — в манифест он не едет
    // (C-8, INV-MAN-4): CSS от записи не зависит, а манифест от неё пухнет.
    expect(card.safelist).toEqual(['shadow-legacy'])
    expect(card.css).toEqual(['components/Card/styles.css'])
    const cardCss = readFileSync(join(dist, 'components/Card/styles.css'), 'utf8')
    expect(cardCss).toContain('font-weight:700')
    expect(cardCss).not.toContain('@apply')
    expect(card.tokens.consumes).toEqual(['--t-bg', '--t-space'])

    const panel = manifest.components.Panel!
    expect(panel.dependencies).toEqual(['Card'])
    expect(panel.classes).toEqual(['flex', 'gap-2'])
    expect(panel.css).toEqual(['components/Panel/styles.css'])
    expect(readFileSync(join(dist, 'components/Panel/styles.css'), 'utf8')).toContain('.t-panel')
    expect(panel.tokens.consumes).toEqual(['--t-fg', '--t-z'])
    expect(panel.tokens.dynamic).toEqual(['--t-z'])
    expect(panel.files.every(f => f.startsWith('components/Panel/') || f.startsWith('chunks/'))).toBe(true)

    expect(manifest.theme.declares).toEqual(['--t-bg', '--t-fallback', '--t-space'])
    expect(readFileSync(join(dist, 'theme/tokens.css'), 'utf8')).toContain('--t-space')
    expect(readFileSync(join(dist, 'theme/dark.css'), 'utf8')).toContain('.dark')
    // Предупреждения о совпавшем safelist больше нет: раскладку чанков, от
    // которой зависит видимость класса, выбирает бандлер, а не автор пакета.
    expect(manifest.warnings).toEqual([])
    expect(logs.at(-1)).toMatch(/@t\/kit: 2 components/)
  })

  it('неучтённое ребро графа — UndeclaredDependencyError; с dependencyCheck: warn — предупреждение (B-8)', async () => {
    await expect(run(makeFixture({ declareDependency: false }))).rejects.toBeInstanceOf(UndeclaredDependencyError)
    const { manifest, logs } = await run(makeFixture({ declareDependency: false }), { dependencyCheck: 'warn' })
    expect(manifest.components.Panel!.dependencies).toEqual([])
    expect(logs.some(l => l.includes('Panel → @t/kit:Card'))).toBe(true)
  })

  it('exports без манифеста и subpath — PackageExportsError; exportsCheck: warn пропускает (B-13)', async () => {
    await expect(run(makeFixture({ exportsOk: false }))).rejects.toBeInstanceOf(PackageExportsError)
    const { logs } = await run(makeFixture({ exportsOk: false }), { exportsCheck: 'warn' })
    expect(logs.some(l => l.includes('./granum.manifest.json'))).toBe(true)
  })

  it('node-импорт в браузерном чанке — BoundaryViolationError (B-16)', async () => {
    await expect(run(makeFixture({ nodeImport: true }))).rejects.toBeInstanceOf(BoundaryViolationError)
    const { logs } = await run(makeFixture({ nodeImport: true }), { boundaryCheck: 'warn' })
    expect(logs.some(l => l.includes('node:fs'))).toBe(true)
  })

  it('объявленный CSS отсутствует — CssReadError с провайдером и компонентом', async () => {
    const failure = run(makeFixture({ brokenCss: true }))
    await expect(failure).rejects.toBeInstanceOf(CssReadError)
    await expect(failure).rejects.toMatchObject({ providerId: '@t/kit', section: 'component', subject: 'Panel' })
  })

  /*
   * Двойная доставка от плагина, который вшивает CSS ПОЗЖЕ нас (INV-CSS-5).
   *
   * Так устроен `vite-plugin-lib-inject-css` и всё, что делает то же самое: он
   * объявлен `enforce: 'post'`, а Vite сортирует плагины pre → normal → post.
   * Наш `generateBundle` идёт раньше, и в `chunk.code` импорта на тот момент
   * ещё нет — увидеть его из объекта бандла нельзя никаким сравнением строк.
   *
   * Прежняя проверка искала литерал `'styles.css'` в `chunk.code` и молчала на
   * двух опубликованных пакетах экосистемы. Её тест проходил, потому что
   * фикстура клала CSS-ассет в `chunk.imports` — форма, которой бандлер не
   * порождает. Здесь стенд настоящий: плагин ниже повторяет поведение
   * `libInjectCss` буквально.
   */
  const injectCssPost = {
    name: 'test:inject-css',
    enforce: 'post' as const,
    generateBundle(_options: unknown, bundle: Record<string, { type: string, code?: string, viteMetadata?: { importedCss?: Set<string> } }>) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk')
          continue
        for (const css of chunk.viteMetadata?.importedCss ?? [])
          chunk.code = `import './${css.slice(css.lastIndexOf('/') + 1)}';\n${chunk.code ?? ''}`
      }
    },
  }

  it('css-double-delivery ловится, когда CSS вшивает post-плагин', async () => {
    const { manifest } = await run(makeFixture(), {}, [injectCssPost])
    const doubled = manifest.warnings.filter(w => w.code === 'css-double-delivery')

    // `Card`, а не `Panel`: стили `Card` лежат в `<style>` её SFC, и бандлер
    // связывает эмитированный ассет с её чанком — туда post-плагин и пишет.
    // CSS `Panel` объявлен в `cssFiles` и копируется нами, чанк о нём не знает.
    expect(doubled.map(w => w.component)).toEqual(['Card'])
    // `files` в предупреждении — открытая деталь (`[detail: string]: unknown`),
    // поэтому сужается здесь, а не берётся из типа.
    const files = doubled[0]?.files as string[] | undefined
    expect(files?.every(f => f.endsWith('.js'))).toBe(true)
  })

  it('`/*` в строке чанка не съедает классы и токены дальше по коду (INV-ENG-5, INV-DIAG-2)', async () => {
    const { manifest } = await run(makeFixture({ fileInput: true }))
    const card = manifest.components.Card!

    expect(card.classes).toEqual(expect.arrayContaining(['sr-only', 'p-4', 'bg-[var(--t-bg)]']))
    expect(card.tokens.consumes).toEqual(expect.arrayContaining(['--t-bg', '--t-space']))
  })

  it('`<style>` SFC и объявленный `styles.css` склеиваются, а не затирают друг друга (B-3, INV-MAN-6)', async () => {
    const { manifest, dist } = await run(makeFixture({ panelStyle: true }))
    const panel = manifest.components.Panel!
    const css = readFileSync(join(dist, 'components/Panel/styles.css'), 'utf8')

    // Порядок — как у списка `css` в манифесте: сначала `cssFiles`, затем эмитированный.
    expect(css).toContain('.t-panel{')
    expect(css).toContain('.t-panel-sfc{')
    expect(css.indexOf('.t-panel{')).toBeLessThan(css.indexOf('.t-panel-sfc{'))
    expect(panel.css).toEqual(['components/Panel/styles.css'])
    expect(panel.tokens.consumes).toEqual(expect.arrayContaining(['--t-fg', '--t-gap']))
  })

  it('пути темы и engineModule с `./` уезжают в манифест нормализованными (C-16, INV-MAN-2)', async () => {
    // Манифест читается штатным читателем: путь с `./` он отверг бы, и упало бы
    // каждое приложение-потребитель, а не сборка провайдера.
    const { manifest } = await run(makeFixture({ dotPaths: true, engineRules: true }), { engineModule: './engine.js' })
    expect(manifest.theme.tokensCss).toBe('theme/tokens.css')
    expect(manifest.theme.themes).toEqual({ dark: 'theme/dark.css' })
    expect(manifest.engine.module).toBe('engine.js')
  })

  /**
   * Провайдер реэкспортирует дескриптор из entry компонента, как ядро
   * granularity. Контракт встраивается в `dist`: собранный компонент
   * грузится в Node без granum — так его грузит SSR с внешними пакетами при
   * деплое с `--omit=dev`.
   */
  it('контракт встроен в dist: компонент грузится без granum, классы строк контракта не берут', async () => {
    const baseline = await run(makeFixture())
    const { dist, manifest } = await run(makeFixture({ runtimeConfig: true }))
    const files = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.js'))
    const granumImports = files.flatMap(f => collectImportSpecifiers(readFileSync(join(dist, f), 'utf8'))).filter(s => s.startsWith('@feugene/granum'))
    expect(granumImports).toEqual([])
    expect(existsSync(join(dist, 'granum/contract.js'))).toBe(true)
    expect(manifest.warnings).toEqual([])
    // Чанк контракта — не код компонента: его строки в классы и токены не попадают.
    expect(manifest.components.Card!.classes).toEqual(baseline.manifest.components.Card!.classes)
    expect(manifest.components.Panel!.classes).toEqual(baseline.manifest.components.Panel!.classes)

    // Рядом есть только vue — granum в node_modules пакета нет.
    mkdirSync(join(dist, '../node_modules'), { recursive: true })
    symlinkSync(join(process.cwd(), '../../node_modules/vue'), join(dist, '../node_modules/vue'), 'dir')
    const card = await import(pathToFileURL(join(dist, 'components/Card/index.js')).href) as { cardConfig: { name: string, cssFiles: string[], tokenDefinitionsRef: Record<string, { url: string }> } }
    expect(card.cardConfig.name).toBe('Card')
    expect(card.cardConfig.cssFiles).toEqual(['components/Card/card.css'])
    expect(card.cardConfig.tokenDefinitionsRef.light!.url).toMatch(/^file:.*\/light\.css$/)
  })

  it('рантайм-импорт другой точки входа granum без peer — peer-missing; с peer — тишина', async () => {
    const missing = await run(makeFixture({ runtimeImport: true }))
    expect(missing.manifest.warnings).toContainEqual({ code: 'peer-missing', provider: '@feugene/granum' })
    const declared = await run(makeFixture({ runtimeImport: true, packageJson: { peerDependencies: { '@feugene/granum': '^2.0.0' } } }))
    expect(declared.manifest.warnings).not.toContainEqual(expect.objectContaining({ provider: '@feugene/granum' }))
  })

  /**
   * Плагин добавляет к `external` своё правило для `@feugene/granum/*`. Через
   * слияние конфигов Vite функция пользователя превращалась в массив
   * `[fn, RegExp]`, которого rolldown не принимает, и сборка падала.
   */
  it('external функцией: внешними остаются и имена пользователя, и @feugene/granum', async () => {
    const fixture = makeFixture()
    writeFileSync(join(fixture.root, 'src/index.ts'), `${readFileSync(join(fixture.root, 'src/index.ts'), 'utf8')}export { createThemeController } from '@feugene/granum/runtime'\n`)
    await build({
      root: fixture.root,
      configFile: false,
      logLevel: 'silent',
      plugins: [vue(), granumProvider({ provider: fixture.provider, engine: testEngine(), log: () => {} })],
      build: { minify: false, rolldownOptions: { external: id => id === 'vue' || id.startsWith('vue/') } },
    })
    const dist = join(fixture.root, 'dist')
    expect(readManifestSync(join(dist, 'granum.manifest.json')).manifest.id).toBe(fixture.provider.id)
    expect(readFileSync(join(dist, 'index.js'), 'utf8')).toContain('from "@feugene/granum/runtime"')
    const chunks = join(dist, 'components/Card/chunks')
    expect(readdirSync(chunks).map(f => readFileSync(join(chunks, f), 'utf8')).join('\n')).toContain('from "vue"')
  })

  it('путь темы за пределами пакета — ошибка при создании плагина', () => {
    const { provider } = makeFixture()
    const escaping = { ...provider, theme: { ...provider.theme!, tokensCss: '../outside.css' } }
    expect(() => granumProvider({ provider: escaping, engine: testEngine() })).toThrow(expect.objectContaining({ reason: 'path-escapes-package' }))
    expect(() => granumProvider({ provider, engine: testEngine(), engineModule: '/abs/engine.js' })).toThrow(expect.objectContaining({ reason: 'path-escapes-package' }))
  })

  it('переменная v-bind() из <style> — присваивание самого компонента, не требование (T-5)', async () => {
    const { manifest } = await run(makeFixture({ vbind: true }))
    const tokens = manifest.components.Card!.tokens
    const vueVar = tokens.consumes.find(t => /^--[0-9a-f]{8}/.test(t))

    expect(vueVar).toBeDefined()
    expect(tokens.requires).not.toContain(vueVar)
  })

  it('часть чужого компонента в общем чанке группы — тоже ребро (B-7)', async () => {
    await expect(run(groupFixture())).rejects.toBeInstanceOf(UndeclaredDependencyError)
    const { manifest } = await run(groupFixture({ declareDependency: true }))
    expect(manifest.components.GA!.dependencies).toEqual(['GB'])
  })

  it('без такого плагина предупреждения нет', async () => {
    const { manifest } = await run(makeFixture())
    expect(manifest.warnings.filter(w => w.code === 'css-double-delivery')).toEqual([])
  })
})
