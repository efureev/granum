import type { GranumManifest, GranumProvider } from '../contract'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { build, parseAst } from 'vite'
import { describe, expect, it } from 'vitest'
import { granumProvider } from '../build/plugin'
import { defineGranumComponent, defineGranumProvider } from '../contract'
import { BoundaryViolationError, CssReadError, EngineDialectMismatchError, InvalidManifestError, PackageExportsError, UndeclaredDependencyError } from '../core/errors'
import { readManifestSync, writeManifestSync } from '../node/manifest'
import { subcomponentsFromExports } from '../node/subcomponents'
import { granum } from '../vite/plugin'
import { makeManifest } from './helpers'
import { TEST_DIALECT, testEngine } from './testEngine'

/**
 * Интеграция плагина с настоящим Vite: временный провайдер из двух
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
  rootImport?: boolean
  /** Поля `package.json` поверх стандартных (`peerDependencies` и т.п.). */
  packageJson?: Record<string, unknown>
  /** Имя пакета и id провайдера; по умолчанию `@t/kit`. */
  name?: string
  /** Каталог тем; `false` — провайдер без тем: владелец каталога в приложении один. */
  catalog?: boolean
} = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'granum-build-'))
  const { declareDependency = true, exportsOk = true, nodeImport = false, brokenCss = false, engineRules = false, plain = false, fileInput = false, panelStyle = false, dotPaths = false, vbind = false, runtimeConfig = false, rootImport = false, packageJson = {}, name = '@t/kit', catalog = true } = options
  const at = dotPaths ? './' : ''
  const input = fileInput ? '<input type="file" accept="image/*" class="sr-only">' : ''

  write(root, 'package.json', JSON.stringify({
    name,
    version: '1.2.3',
    type: 'module',
    exports: exportsOk
      ? { '.': './dist/index.js', './granum.manifest.json': './dist/granum.manifest.json', './components/Card': './dist/components/Card/index.js', './components/Panel': './dist/components/Panel/index.js' }
      : { '.': './dist/index.js' },
    ...packageJson,
  }))
  write(root, 'src/index.ts', `export * from './components/Card/index.ts'\nexport * from './components/Panel/index.ts'\n${rootImport ? `export { defineGranumProvider } from '@feugene/granum'\n` : ''}`)
  write(root, 'src/theme/tokens.css', ':root{--t-space:8px;--t-bg:#fff}\n@supports (x:1){:root{--t-fallback:1}}')
  write(root, 'src/themes/registry.json', JSON.stringify({ 't-bg': 'mode', 't-radius': 'root' }))
  write(root, 'src/themes/kit.json', JSON.stringify({ id: 'kit', title: 'Kit', root: { 't-radius': '4px' }, modes: { light: { colorScheme: 'light', tokens: { 't-bg': '#fff' } }, dark: { colorScheme: 'dark', tokens: { 't-bg': '#000' } } } }))
  write(root, 'src/components/Card/Card.vue', plain
    ? `<script setup lang="ts"></script>\n<template><div class="t-card"><slot /></div></template>\n<style>.t-card{gap:var(--t-space);}</style>\n`
    : `<script setup lang="ts">${nodeImport ? `import { readFileSync } from 'node:fs'; void readFileSync` : ''}${vbind ? `const color = 'red'` : ''}</script>\n<template>${input}<div class="t-card p-4 bg-[var(--t-bg)]"><slot /></div></template>\n<style>.t-card{gap:var(--t-space);@apply font-bold;${vbind ? 'color:v-bind(color);' : ''}}</style>\n`)
  write(root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\n${runtimeConfig ? `export { cardConfig } from './config.ts'\n` : ''}`)
  if (runtimeConfig)
    write(root, 'src/components/Card/config.ts', `import { defineGranumComponent } from '@feugene/granum/contract'\nexport const cardConfig = defineGranumComponent(import.meta.url, { name: 'Card', cssFiles: ['./card.css'], themesDir: './themes' })\n`)
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
    id: name,
    contractVersion: 2,
    components: [card, panel],
    theme: catalog
      ? { tokensCss: `${at}theme/tokens.css`, registry: `${at}themes/registry.json`, defaultTheme: 'kit', catalog: { kit: { title: 'Kit', data: `${at}themes/kit.json` } } }
      : { tokensCss: `${at}theme/tokens.css` },
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
  const provider = defineGranumProvider({ id: '@t/grp', contractVersion: 2, components: [ga, gb] })
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

/**
 * Импорты модуля по AST: `import`, `export … from` и `import()` со строкой.
 * Не текстом — в сообщениях контракта есть «from '@feugene/granum/contract'»
 * внутри шаблонной строки, и текстовый поиск принял бы его за импорт.
 */
function importsOf(code: string): string[] {
  const out: string[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object')
      return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const n = node as { type?: string, source?: { type?: string, value?: unknown } }
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration' || n.type === 'ImportExpression')
      && n.source?.type === 'Literal' && typeof n.source.value === 'string') {
      out.push(n.source.value)
    }
    Object.values(node).forEach(visit)
  }
  visit(parseAst(code))
  return out
}
describe('granumProvider с настоящим Vite', () => {
  it('правила движка без engineModule — предупреждение, а не тихая потеря', async () => {
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

  it('нарушение границы не переезжает в следующую сборку того же инстанса', async () => {
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

  it('движок артефакта — факт: блок engine и отказ приписать чужой словарь', async () => {
    const engine = testEngine()
    const { manifest } = await run(makeFixture())
    expect(manifest.engine).toEqual({ dialect: engine.dialect, vocabulary: engine.vocabulary, name: engine.name, module: null })

    // Провайдер утверждает один словарь, а собирают его другим — записать в
    // манифест чужой диалект нельзя. Падает на создании плагина, до первого
    // хука: раньше некуда.
    const provider = { ...makeFixture().provider, engine: { dialect: 'other/atoms@1' } }
    expect(() => granumProvider({ provider, engine, log: () => {} })).toThrow(EngineDialectMismatchError)
  })

  it('пакет без утилит получает dialect: null', async () => {
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

  it('раскладка, манифест, классы, токены, копии CSS, @apply, exports', async () => {
    const { manifest, dist, logs } = await run(makeFixture())

    expect(manifest.id).toBe('@t/kit')
    expect(manifest.version).toBe('1.2.3')
    expect(Object.keys(manifest.components)).toEqual(['Card', 'Panel'])

    const card = manifest.components.Card!
    expect(card.entry).toBe('components/Card/index.js')
    expect(card.classes).toEqual(['bg-[var(--t-bg)]', 'p-4'])
    // `p-4` объявлен в safelist и найден извлечением — в манифест он не едет:
    // CSS от записи не зависит, а манифест от неё пухнет.
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

    expect(manifest.theme.declares).toEqual(['--t-bg', '--t-fallback', '--t-radius', '--t-space'])
    expect(readFileSync(join(dist, 'theme/tokens.css'), 'utf8')).toContain('--t-space')
    expect(JSON.parse(readFileSync(join(dist, 'themes/kit.json'), 'utf8')).modes.dark.tokens).toEqual({ 't-bg': '#000' })
    expect(manifest.theme.catalog).toEqual({ kit: { title: 'Kit', data: 'themes/kit.json', modes: ['light', 'dark'], defaultMode: 'light' } })
    // Предупреждения о совпавшем safelist больше нет: раскладку чанков, от
    // которой зависит видимость класса, выбирает бандлер, а не автор пакета.
    expect(manifest.warnings).toEqual([])
    expect(logs.at(-1)).toMatch(/@t\/kit: 2 components/)
  })

  it('неучтённое ребро графа — UndeclaredDependencyError; с dependencyCheck: warn — предупреждение', async () => {
    await expect(run(makeFixture({ declareDependency: false }))).rejects.toBeInstanceOf(UndeclaredDependencyError)
    const { manifest, logs } = await run(makeFixture({ declareDependency: false }), { dependencyCheck: 'warn' })
    expect(manifest.components.Panel!.dependencies).toEqual([])
    expect(logs.some(l => l.includes('Panel → @t/kit:Card'))).toBe(true)
  })

  /** `exports` строкой — один корневой subpath: ни манифеста, ни компонентов в нём нет. */
  it('exports строкой — PackageExportsError, а не TypeError', async () => {
    await expect(run(makeFixture({ packageJson: { exports: './dist/index.js' } }))).rejects.toBeInstanceOf(PackageExportsError)
    const { logs } = await run(makeFixture({ packageJson: { exports: './dist/index.js' } }), { exportsCheck: 'warn' })
    expect(logs.some(l => l.startsWith('warning:') && l.includes('granum.manifest.json'))).toBe(true)
  })

  it('exports без манифеста и subpath — PackageExportsError; exportsCheck: warn пропускает', async () => {
    await expect(run(makeFixture({ exportsOk: false }))).rejects.toBeInstanceOf(PackageExportsError)
    const { logs } = await run(makeFixture({ exportsOk: false }), { exportsCheck: 'warn' })
    expect(logs.some(l => l.includes('./granum.manifest.json'))).toBe(true)
  })

  it('node-импорт в браузерном чанке — BoundaryViolationError', async () => {
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
   * Двойная доставка от плагина, который вшивает CSS ПОЗЖЕ нас.
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

  it('`/*` в строке чанка не съедает классы и токены дальше по коду', async () => {
    const { manifest } = await run(makeFixture({ fileInput: true }))
    const card = manifest.components.Card!

    expect(card.classes).toEqual(expect.arrayContaining(['sr-only', 'p-4', 'bg-[var(--t-bg)]']))
    expect(card.tokens.consumes).toEqual(expect.arrayContaining(['--t-bg', '--t-space']))
  })

  it('`<style>` SFC и объявленный `styles.css` склеиваются, а не затирают друг друга', async () => {
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

  it('пути темы и engineModule с `./` уезжают в манифест нормализованными', async () => {
    // Манифест читается штатным читателем: путь с `./` он отверг бы, и упало бы
    // каждое приложение-потребитель, а не сборка провайдера.
    const { manifest } = await run(makeFixture({ dotPaths: true, engineRules: true }), { engineModule: './engine.js' })
    expect(manifest.theme.tokensCss).toBe('theme/tokens.css')
    expect(manifest.theme.registry).toBe('themes/registry.json')
    expect(manifest.theme.catalog!.kit!.data).toBe('themes/kit.json')
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
    const granumImports = files.flatMap(f => importsOf(readFileSync(join(dist, f), 'utf8'))).filter(s => s.startsWith('@feugene/granum'))
    expect(granumImports).toEqual([])
    expect(existsSync(join(dist, 'granum/contract.js'))).toBe(true)
    expect(manifest.warnings).toEqual([])
    // Чанк контракта — не код компонента: его строки в классы и токены не попадают.
    expect(manifest.components.Card!.classes).toEqual(baseline.manifest.components.Card!.classes)
    expect(manifest.components.Panel!.classes).toEqual(baseline.manifest.components.Panel!.classes)

    // Рядом есть только vue — granum в node_modules пакета нет.
    mkdirSync(join(dist, '../node_modules'), { recursive: true })
    symlinkSync(join(process.cwd(), '../../node_modules/vue'), join(dist, '../node_modules/vue'), 'dir')
    const card = await import(pathToFileURL(join(dist, 'components/Card/index.js')).href) as { cardConfig: { name: string, cssFiles: string[], themesDir: string } }
    expect(card.cardConfig.name).toBe('Card')
    expect(card.cardConfig.cssFiles).toEqual(['components/Card/card.css'])
    expect(card.cardConfig.themesDir).toBe('components/Card/themes')
  })

  it('рантайм-импорт другой точки входа granum без peer — peer-missing; с peer — тишина', async () => {
    const missing = await run(makeFixture({ rootImport: true }))
    expect(missing.manifest.warnings).toContainEqual({ code: 'peer-missing', provider: '@feugene/granum' })
    const declared = await run(makeFixture({ rootImport: true, packageJson: { peerDependencies: { '@feugene/granum': '^2.0.0' } } }))
    expect(declared.manifest.warnings).not.toContainEqual(expect.objectContaining({ provider: '@feugene/granum' }))
  })

  /**
   * Плагин добавляет к `external` своё правило для `@feugene/granum/*`. Через
   * слияние конфигов Vite функция пользователя превращалась в массив
   * `[fn, RegExp]`, которого rolldown не принимает, и сборка падала.
   */
  it('external функцией: внешними остаются и имена пользователя, и @feugene/granum', async () => {
    const fixture = makeFixture()
    writeFileSync(join(fixture.root, 'src/index.ts'), `${readFileSync(join(fixture.root, 'src/index.ts'), 'utf8')}export { defineGranumProvider } from '@feugene/granum'\n`)
    await build({
      root: fixture.root,
      configFile: false,
      logLevel: 'silent',
      plugins: [vue(), granumProvider({ provider: fixture.provider, engine: testEngine(), log: () => {} })],
      build: { minify: false, rolldownOptions: { external: id => id === 'vue' || id.startsWith('vue/') } },
    })
    const dist = join(fixture.root, 'dist')
    expect(readManifestSync(join(dist, 'granum.manifest.json')).manifest.id).toBe(fixture.provider.id)
    expect(readFileSync(join(dist, 'index.js'), 'utf8')).toContain('from "@feugene/granum"')
    const chunks = join(dist, 'components/Card/chunks')
    expect(readdirSync(chunks).map(f => readFileSync(join(chunks, f), 'utf8')).join('\n')).toContain('from "vue"')
  })

  it('путь темы за пределами пакета — ошибка при создании плагина', () => {
    const { provider } = makeFixture()
    const escaping = { ...provider, theme: { ...provider.theme!, tokensCss: '../outside.css' } }
    expect(() => granumProvider({ provider: escaping, engine: testEngine() })).toThrow(expect.objectContaining({ reason: 'path-escapes-package' }))
    expect(() => granumProvider({ provider, engine: testEngine(), engineModule: '/abs/engine.js' })).toThrow(expect.objectContaining({ reason: 'path-escapes-package' }))
  })

  it('переменная v-bind() из <style> — присваивание самого компонента, не требование', async () => {
    const { manifest } = await run(makeFixture({ vbind: true }))
    const tokens = manifest.components.Card!.tokens
    const vueVar = tokens.consumes.find(t => /^--[0-9a-f]{8}/.test(t))

    expect(vueVar).toBeDefined()
    expect(tokens.requires).not.toContain(vueVar)
  })

  it('часть чужого компонента в общем чанке группы — тоже ребро', async () => {
    await expect(run(groupFixture())).rejects.toBeInstanceOf(UndeclaredDependencyError)
    const { manifest } = await run(groupFixture({ declareDependency: true }))
    expect(manifest.components.GA!.dependencies).toEqual(['GB'])
  })

  it('без такого плагина предупреждения нет', async () => {
    const { manifest } = await run(makeFixture())
    expect(manifest.warnings.filter(w => w.code === 'css-double-delivery')).toEqual([])
  })
})

/**
 * Встроенный контракт granum в `dist` провайдера. Переработка трогает раскладку,
 * граф, извлечение классов и границу кода, поэтому каждый инвариант, который она
 * могла задеть, проверяется здесь отдельно — на настоящей сборке Vite.
 */
describe('встроенный контракт в dist провайдера', () => {
  const CONTRACT = 'granum/contract.js'
  /** Строка из сообщения встроенного хелпера: её наличие — код контракта в файле. */
  const CONTRACT_CODE = 'importMetaUrl must be a non-empty string'

  function jsFiles(dist: string): string[] {
    return readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.js')).sort()
  }
  /** Импорты granum в `dist` вида `<файл> → <спецификатор>`: провал называет файл. */
  function granumImports(dist: string): string[] {
    return jsFiles(dist).flatMap(f => importsOf(readFileSync(join(dist, f), 'utf8')).filter(s => s.startsWith('@feugene/granum')).map(s => `${f} → ${s}`))
  }

  it('провайдер без контракта в коде — чанка контракта нет', async () => {
    const { dist } = await run(makeFixture())
    expect(existsSync(join(dist, CONTRACT))).toBe(false)
    expect(granumImports(dist)).toEqual([])
  })

  it('импорт только типов из контракта ничего не встраивает и не предупреждает', async () => {
    const fixture = makeFixture()
    write(fixture.root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\nexport type { GranumComponentDescriptor } from '@feugene/granum/contract'\n`)
    const { dist, manifest } = await run(fixture)
    expect(existsSync(join(dist, CONTRACT))).toBe(false)
    expect(granumImports(dist)).toEqual([])
    expect(manifest.warnings).toEqual([])
  })

  it('код контракта — только в своём чанке: самодостаточен, без node:, data: и granum', async () => {
    const { dist } = await run(makeFixture({ runtimeConfig: true }))
    const contract = readFileSync(join(dist, CONTRACT), 'utf8')
    expect(contract).toContain(CONTRACT_CODE)
    // Чанк ничего не импортирует: ни node:, ни granum, ни код провайдера.
    expect(importsOf(contract)).toEqual([])
    expect(contract).not.toContain('data:')
    // Аннотация чистоты доехала: бандлер приложения вправе выбросить неиспользуемый вызов.
    expect(contract).toContain('__NO_SIDE_EFFECTS__')
    for (const file of jsFiles(dist).filter(f => f !== CONTRACT))
      expect(readFileSync(join(dist, file), 'utf8'), file).not.toContain(CONTRACT_CODE)
  })

  it('манифест: файлы, классы и токены компонентов — без чанка контракта', async () => {
    const baseline = await run(makeFixture())
    const { manifest } = await run(makeFixture({ runtimeConfig: true }))
    for (const name of ['Card', 'Panel']) {
      const component = manifest.components[name]!
      const before = baseline.manifest.components[name]!
      // По \`files\` приложение пересчитывает классы при чужом словаре: контракта там быть не должно.
      expect(component.files.some(f => f.startsWith('granum/')), name).toBe(false)
      expect(component.classes, name).toEqual(before.classes)
      expect(component.tokens, name).toEqual(before.tokens)
      expect(component.dependencies, name).toEqual(before.dependencies)
    }
  })

  it('незаявленная зависимость компонента ловится и с контрактом', async () => {
    await expect(run(makeFixture({ runtimeConfig: true, declareDependency: false }))).rejects.toBeInstanceOf(UndeclaredDependencyError)
  })

  it('node:-импорт в коде компонента ловится и с контрактом', async () => {
    await expect(run(makeFixture({ runtimeConfig: true, nodeImport: true }))).rejects.toBeInstanceOf(BoundaryViolationError)
  })

  it('рантайм режимов встраивается в чанк granum: dist без импортов granum и без peer-missing', async () => {
    const fixture = makeFixture({ runtimeConfig: true })
    write(fixture.root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\nexport { cardConfig } from './config.ts'\nexport { createThemeController } from '@feugene/granum/runtime'\n`)
    const { dist, manifest } = await run(fixture)
    expect(granumImports(dist)).toEqual([])
    expect(readFileSync(join(dist, CONTRACT), 'utf8')).toContain('createThemeController: the manifest has no modes')
    expect(importsOf(readFileSync(join(dist, CONTRACT), 'utf8'))).toEqual([])
    expect(manifest.warnings).toEqual([])
    expect(manifest.components.Card!.files.some(f => f.startsWith('granum/'))).toBe(false)
  })

  it('динамический импорт контракта встраивается в тот же чанк', async () => {
    const fixture = makeFixture()
    write(fixture.root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\nexport const loadCardConfig = () => import('@feugene/granum/contract').then(m => m.defineGranumComponent(import.meta.url, { name: 'Card' }))\n`)
    const { dist, manifest } = await run(fixture)
    expect(granumImports(dist)).toEqual([])
    expect(existsSync(join(dist, CONTRACT))).toBe(true)
    expect(manifest.warnings).toEqual([])
  })

  it('импорт хелпера из корня @feugene/granum не встраивается — peer-missing', async () => {
    const fixture = makeFixture()
    write(fixture.root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\nexport { cardConfig } from './config.ts'\n`)
    write(fixture.root, 'src/components/Card/config.ts', `import { defineGranumComponent } from '@feugene/granum'\nexport const cardConfig = defineGranumComponent(import.meta.url, { name: 'Card' })\n`)
    const { dist, manifest } = await run(fixture)
    expect(granumImports(dist)).toContainEqual(expect.stringMatching(/ → @feugene\/granum$/))
    expect(manifest.warnings).toContainEqual({ code: 'peer-missing', provider: '@feugene/granum' })
  })

  it('external пользователя, забравший контракт, оставляет его внешним — и сборка об этом говорит', async () => {
    const fixture = makeFixture({ runtimeConfig: true })
    await build({
      root: fixture.root,
      configFile: false,
      logLevel: 'silent',
      plugins: [vue(), granumProvider({ provider: fixture.provider, engine: testEngine(), log: () => {} })],
      build: { minify: false, rolldownOptions: { external: ['vue', /^@feugene\//] } },
    })
    const dist = join(fixture.root, 'dist')
    expect(granumImports(dist)).toContainEqual(expect.stringMatching(/ → @feugene\/granum\/contract$/))
    expect(readManifestSync(join(dist, 'granum.manifest.json')).manifest.warnings).toContainEqual({ code: 'peer-missing', provider: '@feugene/granum' })
  })

  it('группа чанков пользователя не забирает контракт', async () => {
    const baseline = await run(makeFixture())
    const fixture = makeFixture({ runtimeConfig: true })
    await build({
      root: fixture.root,
      configFile: false,
      logLevel: 'silent',
      plugins: [vue(), granumProvider({ provider: fixture.provider, engine: testEngine(), log: () => {} })],
      build: { minify: false, rolldownOptions: { external: ['vue'], output: { codeSplitting: { groups: [{ name: 'vendor', test: /contract|validate|dialect/ }] } } } },
    })
    const dist = join(fixture.root, 'dist')
    expect(existsSync(join(dist, CONTRACT))).toBe(true)
    expect(jsFiles(dist).filter(f => f !== CONTRACT).some(f => readFileSync(join(dist, f), 'utf8').includes(CONTRACT_CODE))).toBe(false)
    const { manifest } = readManifestSync(join(dist, 'granum.manifest.json'))
    expect(manifest.components.Card!.classes).toEqual(baseline.manifest.components.Card!.classes)
  })

  it('повторная сборка даёт тот же dist побайтно', async () => {
    const fixture = makeFixture({ runtimeConfig: true })
    const snapshot = async (): Promise<Record<string, string>> => {
      const { dist } = await run(fixture)
      return Object.fromEntries(readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter(f => /\.(?:js|css|json)$/.test(f)).sort().map(f => [f, readFileSync(join(dist, f), 'utf8')]))
    }
    const first = await snapshot()
    expect(await snapshot()).toEqual(first)
  })

  it('объектная форма провайдера в dist грузится без granum', async () => {
    const fixture = makeFixture({ runtimeConfig: true })
    write(fixture.root, 'src/granum-provider/index.ts', `import { defineGranumProvider } from '@feugene/granum/contract'\nimport { cardConfig } from '../components/Card/config.ts'\nexport default defineGranumProvider({ id: '@t/kit', contractVersion: 2, components: [cardConfig] })\n`)
    const { dist } = await run(fixture, { entries: { 'granum-provider/index': 'src/granum-provider/index.ts' } })
    expect(granumImports(dist)).toEqual([])
    mkdirSync(join(dist, '../node_modules'), { recursive: true })
    symlinkSync(join(process.cwd(), '../../node_modules/vue'), join(dist, '../node_modules/vue'), 'dir')
    const provider = (await import(pathToFileURL(join(dist, 'granum-provider/index.js')).href) as { default: GranumProvider }).default
    expect(provider.id).toBe('@t/kit')
    expect(provider.components.map(c => c.name)).toEqual(['Card'])
  })

  /**
   * У каждого провайдера своя копия контракта. Конфиг, который приложение не
   * использует, бандлер обязан выбросить вместе с копией — иначе приложение на
   * восьми провайдерах везло бы восемь копий.
   */
  it('клиентский бандл приложения: неиспользуемые конфиги выброшены вместе с копиями контракта', async () => {
    const kit = makeFixture({ runtimeConfig: true })
    const kit2 = makeFixture({ runtimeConfig: true, name: '@t/kit2', catalog: false })
    await run(kit)
    await run(kit2)

    const bundle = async (main: string): Promise<string> => {
      const root = mkdtempSync(join(tmpdir(), 'granum-contract-app-'))
      mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
      symlinkSync(kit.root, join(root, 'node_modules/@t/kit'), 'dir')
      symlinkSync(kit2.root, join(root, 'node_modules/@t/kit2'), 'dir')
      symlinkSync(join(process.cwd(), '../../node_modules/vue'), join(root, 'node_modules/vue'), 'dir')
      write(root, 'index.html', `<!doctype html><div id="app"></div><script type="module" src="/src/main.ts"></script>`)
      write(root, 'src/main.ts', main)
      await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), granum({ engine: testEngine(), providers: ['@t/kit', '@t/kit2'], components: 'all' }, { log: () => {} })] })
      const assets = join(root, 'dist/assets')
      return readdirSync(assets).filter(f => f.endsWith('.js')).map(f => readFileSync(join(assets, f), 'utf8')).join('\n')
    }

    const unused = await bundle(`import { Card } from '@t/kit/components/Card'\nimport { Card as Card2 } from '@t/kit2/components/Card'\nconsole.log(Card, Card2)\n`)
    expect(unused).not.toContain(CONTRACT_CODE)

    const used = await bundle(`import { Card, cardConfig } from '@t/kit/components/Card'\nimport { Card as Card2 } from '@t/kit2/components/Card'\nconsole.log(Card, Card2, cardConfig.name)\n`)
    expect(used.split(CONTRACT_CODE)).toHaveLength(2)
  })
})

/**
 * Часть составного компонента — подпуть `./components/<Part>`, который ведёт в
 * entry владельца. Сборка записывает её в манифест владельца: из манифеста её
 * узнают guard, селекция и граф провайдера, читающего этот пакет донором.
 */
describe('части составного компонента из exports', () => {
  const components = [
    { name: 'Card', entries: ['dist/components/Card/index.js', 'src/components/Card/index.ts'] },
    { name: 'Panel', entries: ['dist/components/Panel/index.js'] },
  ]

  it('алиас на entry владельца — часть; цели — все строковые листья, кроме types', () => {
    expect(subcomponentsFromExports({
      '.': './dist/index.js',
      './components/Card': './dist/components/Card/index.js',
      './components/CardItem': './dist/components/Card/index.js',
      './components/CardHead': { types: './dist/types/CardHead.d.ts', import: './dist/components/Card/index.js' },
      './components/CardFoot': { node: { import: './dist/components/Card/index.js' } },
      './components/CardSide': ['./dist/components/Card/index.js'],
      './components/CardDev': { development: './src/components/Card/index.ts', default: null },
      './components/CardTypes': { types: './dist/components/Card/index.js' },
      './components/Card*': './dist/components/Card/index.js',
      './components/Card/styles.css': './dist/components/Card/styles.css',
      './components/Loose': './dist/index.js',
      './components/Both': ['./dist/components/Card/index.js', './dist/components/Panel/index.js'],
    }, components)).toEqual({ byOwner: { Card: ['CardDev', 'CardFoot', 'CardHead', 'CardItem', 'CardSide'] }, ambiguous: ['Both'] })
  })

  it('exports не объект — частей нет', () => {
    expect(subcomponentsFromExports('./dist/index.js', components)).toEqual({ byOwner: {}, ambiguous: [] })
    expect(subcomponentsFromExports(undefined, components)).toEqual({ byOwner: {}, ambiguous: [] })
  })

  it('сборка пишет части в запись владельца; без алиасов поля нет', async () => {
    const plain = await run(makeFixture())
    expect(Object.values(plain.manifest.components).some(c => 'subcomponents' in c)).toBe(false)
    const { manifest } = await run(makeFixture({
      packageJson: {
        exports: {
          '.': './dist/index.js',
          './granum.manifest.json': './dist/granum.manifest.json',
          './components/Card': './dist/components/Card/index.js',
          './components/CardPart': './dist/components/Card/index.js',
          './components/Panel': './dist/components/Panel/index.js',
        },
      },
    }))
    expect(manifest.components.Card?.subcomponents).toEqual(['CardPart'])
    expect(manifest.components.Panel).not.toHaveProperty('subcomponents')
  })

  /**
   * Пакет за симлинком: Vite приводит корень к реальному пути, каталоги
   * исходников приходят такими же, и цель на исходный entry сравнивается в одной
   * форме. Симлинк заводит сам тест — временный каталог симлинком бывает не
   * везде (`/var` на macOS — да, `/tmp` на Linux — нет).
   */
  it('цель на исходный entry находится и при корне через симлинк', async () => {
    const fixture = makeFixture({
      packageJson: {
        exports: {
          '.': './dist/index.js',
          './granum.manifest.json': './dist/granum.manifest.json',
          './components/Card': './dist/components/Card/index.js',
          './components/CardDev': { development: './src/components/Card/index.ts' },
          './components/Panel': './dist/components/Panel/index.js',
        },
      },
    })
    const link = `${fixture.root}-link`
    symlinkSync(fixture.root, link, 'dir')
    const { manifest } = await run({ ...fixture, root: link })
    expect(manifest.components.Card?.subcomponents).toEqual(['CardDev'])
  })

  /** Пакет `@t/uses`, чей `Row` импортирует часть `DListItem` донора `@d/core` по её подпути. */
  function donorFixture(): { root: string, build: () => Promise<GranumManifest> } {
    const root = mkdtempSync(join(tmpdir(), 'granum-donor-part-'))
    write(root, 'node_modules/@d/core/package.json', JSON.stringify({
      name: '@d/core',
      version: '1.0.0',
      type: 'module',
      exports: { './granum.manifest.json': './dist/granum.manifest.json', './components/DList': './dist/components/DList/index.js', './components/DListItem': './dist/components/DList/index.js' },
    }))
    const { hash: _hash, ...donor } = makeManifest('@d/core', { DList: { subcomponents: ['DListItem'] } }).manifest
    writeManifestSync(join(root, 'node_modules/@d/core/dist/granum.manifest.json'), donor)
    write(root, 'package.json', JSON.stringify({
      name: '@t/uses',
      version: '1.0.0',
      type: 'module',
      peerDependencies: { '@d/core': '^1.0.0' },
      exports: { './granum.manifest.json': './dist/granum.manifest.json', './components/Row': './dist/components/Row/index.js' },
    }))
    write(root, 'src/components/Row/Row.vue', `<script setup lang="ts">\nimport { DListItem } from '@d/core/components/DListItem'\n</script>\n<template><DListItem class="p-2" /></template>\n`)
    write(root, 'src/components/Row/index.ts', `export { default as Row } from './Row.vue'\n`)
    const row = defineGranumComponent(pathToFileURL(join(root, 'src/components/Row/config.ts')).href, { name: 'Row', dependencies: ['@d/core:DList'] })
    const provider = defineGranumProvider({ id: '@t/uses', contractVersion: 1, dependencies: ['@d/core'], components: [row] })
    return {
      root,
      build: async () => {
        await build({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [vue(), granumProvider({ provider, engine: testEngine(), indexEntry: false, log: () => {} })],
          build: { minify: false, rolldownOptions: { external: id => id === 'vue' || id.startsWith('@d/core') } },
        })
        return JSON.parse(readFileSync(join(root, 'dist/granum.manifest.json'), 'utf8')) as GranumManifest
      },
    }
  }

  it('импорт части донора по её подпути — ребро на владельца: объявленный владелец его покрывает', async () => {
    const manifest = await donorFixture().build()
    expect(manifest.components.Row?.dependencies).toEqual(['@d/core:DList'])
  })

  it('битый манифест донора — ошибка, а не тихий пропуск сведения', async () => {
    const donor = donorFixture()
    const file = join(donor.root, 'node_modules/@d/core/dist/granum.manifest.json')
    writeFileSync(file, readFileSync(file, 'utf8').replace('"DList"', '"DList2"'))
    await expect(donor.build()).rejects.toBeInstanceOf(InvalidManifestError)
  })

  /**
   * Свой подпуть части, вынесенный во внешние: части берутся из своих `exports`,
   * а не из манифеста прошлой сборки, которого может и не быть.
   */
  it('свой подпуть части во внешних — ребро на своего владельца', async () => {
    const root = mkdtempSync(join(tmpdir(), 'granum-self-part-'))
    write(root, 'package.json', JSON.stringify({
      name: '@t/self',
      version: '1.0.0',
      type: 'module',
      exports: {
        './granum.manifest.json': './dist/granum.manifest.json',
        './components/Card': './dist/components/Card/index.js',
        './components/CardPart': './dist/components/Card/index.js',
        './components/Row': './dist/components/Row/index.js',
      },
    }))
    write(root, 'src/components/Card/Card.vue', `<template><div class="p-4"><slot /></div></template>\n`)
    write(root, 'src/components/Card/CardPart.vue', `<template><span class="p-2"><slot /></span></template>\n`)
    write(root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\nexport { default as CardPart } from './CardPart.vue'\n`)
    write(root, 'src/components/Row/Row.vue', `<script setup lang="ts">\nimport { CardPart } from '@t/self/components/CardPart'\n</script>\n<template><CardPart /></template>\n`)
    write(root, 'src/components/Row/index.ts', `export { default as Row } from './Row.vue'\n`)
    const url = (name: string): string => pathToFileURL(join(root, `src/components/${name}/config.ts`)).href
    const provider = defineGranumProvider({
      id: '@t/self',
      contractVersion: 1,
      components: [defineGranumComponent(url('Card'), { name: 'Card' }), defineGranumComponent(url('Row'), { name: 'Row', dependencies: ['Card'] })],
    })
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [vue(), granumProvider({ provider, engine: testEngine(), indexEntry: false, log: () => {} })],
      build: { minify: false, rolldownOptions: { external: id => id === 'vue' || id.startsWith('@t/self/') } },
    })
    const manifest = JSON.parse(readFileSync(join(root, 'dist/granum.manifest.json'), 'utf8')) as GranumManifest
    expect(manifest.components.Card?.subcomponents).toEqual(['CardPart'])
  })
})

/**
 * Темы на сборке провайдера (B-10, C-24…C-31, C-33): данные с `extends`
 * дополняются из родителя и проверяются по реестру до записи, папка
 * `themesDir` материализуется в манифест.
 */
describe('темы на сборке провайдера', () => {
  const withTheme = (fixture: Fixture, theme: NonNullable<GranumProvider['theme']>, files: Record<string, unknown> = {}): Fixture => {
    for (const [rel, data] of Object.entries(files))
      write(fixture.root, `src/${rel}`, typeof data === 'string' ? data : JSON.stringify(data))
    return { root: fixture.root, provider: { ...fixture.provider, theme } }
  }
  const KIT_CATALOG = { kit: { title: 'Kit', data: 'themes/kit.json' } }

  it('тема с extends: отличия слиты с родителем, в dist — полные данные', async () => {
    const fixture = withTheme(makeFixture(), {
      registry: 'themes/registry.json',
      defaultTheme: 'kit',
      catalog: { ...KIT_CATALOG, night: { title: 'Night', extends: 'kit', data: 'themes/night.json' } },
    }, { 'themes/night.json': { root: { 't-radius': '0' }, modes: { dark: { tokens: { 't-bg': '#111' } }, dim: { colorScheme: 'dark', extends: 'dark', tokens: {} } } } })
    const { manifest, dist } = await run(fixture)
    const night = JSON.parse(readFileSync(join(dist, 'themes/night.json'), 'utf8'))
    expect(night).toMatchObject({ id: 'night', title: 'Night', root: { 't-radius': '0' } })
    expect(night.modes.light.tokens).toEqual({ 't-bg': '#fff' })
    expect(night.modes.dark).toEqual({ colorScheme: 'dark', tokens: { 't-bg': '#111' } })
    expect(manifest.theme.catalog!.night).toEqual({ title: 'Night', extends: 'kit', data: 'themes/night.json', modes: ['light', 'dark', 'dim'], defaultMode: 'light' })
  })

  it('тема без токена реестра — theme-incomplete с перечнем', async () => {
    const fixture = withTheme(makeFixture(), { registry: 'themes/registry.json', catalog: KIT_CATALOG }, {
      'themes/registry.json': { 't-bg': 'mode', 't-radius': 'root', 't-fg': 'mode' },
    })
    await expect(run(fixture)).rejects.toMatchObject({ reason: 'theme-incomplete', tokens: ['dark:t-fg', 'light:t-fg'] })
  })

  it('ошибки данных: default-mode-missing, mode-extends-cycle, invalid-mode-name', async () => {
    const broken = (data: unknown): Fixture => withTheme(makeFixture(), { catalog: KIT_CATALOG }, { 'themes/kit.json': data })
    await expect(run(broken({ id: 'kit', title: 'K', root: {}, modes: { dark: { colorScheme: 'dark', tokens: {} } } }))).rejects.toMatchObject({ reason: 'default-mode-missing' })
    await expect(run(broken({ id: 'kit', title: 'K', root: {}, modes: { light: { colorScheme: 'light', extends: 'dark', tokens: {} }, dark: { colorScheme: 'dark', extends: 'light', tokens: {} } } }))).rejects.toMatchObject({ reason: 'mode-extends-cycle' })
    await expect(run(broken({ id: 'kit', title: 'K', root: {}, modes: { 'light': { colorScheme: 'light', tokens: {} }, 'high-contrast': { colorScheme: 'dark', tokens: {} } } }))).rejects.toMatchObject({ reason: 'invalid-mode-name' })
  })

  it('путь данных темы за пределами пакета — path-escapes-package при создании плагина', () => {
    const { provider } = makeFixture()
    const escaping = { ...provider, theme: { catalog: { kit: { title: 'Kit', data: '../kit.json' } } } }
    expect(() => granumProvider({ provider: escaping, engine: testEngine() })).toThrow(expect.objectContaining({ reason: 'path-escapes-package' }))
  })

  it('themesDir компонента материализуется в tokens.themes; без него поля нет', async () => {
    const fixture = makeFixture()
    write(fixture.root, 'src/components/Card/themes/kit/modes/light.json', '{"t-card-bg":"#fafafa"}')
    write(fixture.root, 'src/components/Card/themes/kit/root.css', ':root { --t-card-gap: 4px; }')
    const card = { ...fixture.provider.components[0]!, themesDir: 'components/Card/themes' }
    const { manifest } = await run({ root: fixture.root, provider: { ...fixture.provider, components: [card, fixture.provider.components[1]!] } })
    expect(manifest.components.Card!.tokens.themes).toEqual({ kit: { root: { 't-card-gap': '4px' }, modes: { light: { 't-card-bg': '#fafafa' } } } })
    expect(manifest.components.Panel!.tokens.themes).toBeUndefined()
  })
})
