import type { InlineConfig } from 'vite'
import type { GranumConfig } from '../config'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { build, createBuilder } from 'vite'
import { describe, expect, it } from 'vitest'
import { granumProvider } from '../build/plugin'
import { defineGranumComponent, defineGranumProvider } from '../contract'
import { ComponentOutsideSelectionError, ComponentRootImportError } from '../core/errors'
import { granum } from '../vite/plugin'
import { TEST_DIALECT, testEngine } from './testEngine'

/**
 * Сквозная интеграция: провайдер собирается плагином `granumProvider`
 * во временный пакет, приложение подключает его по имени через `node_modules`
 * и собирается плагином `granum` настоящим Vite.
 */
function write(root: string, rel: string, content: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}

async function buildProvider(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'granum-app-provider-'))
  write(root, 'package.json', JSON.stringify({
    name: '@t/kit',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './dist/index.js', './granum.manifest.json': './dist/granum.manifest.json', './components/Card': './dist/components/Card/index.js', './components/Panel': './dist/components/Panel/index.js', './components/Table': './dist/components/Table/index.js' },
  }))
  write(root, 'src/theme/tokens.css', ':root{--t-space:8px;--t-unused:1px}')
  write(root, 'src/themes/kit.json', JSON.stringify({ id: 'kit', title: 'Kit', root: {}, modes: { light: { colorScheme: 'light', tokens: { 't-bg': '#fff' } }, dark: { colorScheme: 'dark', tokens: { 't-bg': '#000' } } } }))
  write(root, 'src/themes/slab.json', JSON.stringify({ id: 'slab', title: 'Slab', root: {}, modes: { light: { colorScheme: 'light', tokens: { 't-bg': '#eee' } }, dark: { colorScheme: 'dark', tokens: { 't-bg': '#111' } } } }))
  write(root, 'src/components/Card/Card.vue', `<template><div class="t-card p-4 bg-[var(--t-bg)]"><slot /></div></template>\n<style>.t-card{gap:var(--t-space)}</style>\n`)
  write(root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\n`)
  write(root, 'src/components/Panel/Panel.vue', `<script setup lang="ts">\nimport { Card } from '../Card/index.ts'\n</script>\n<template><section class="flex gap-2"><Card /></section></template>\n`)
  write(root, 'src/components/Panel/index.ts', `export { default as Panel } from './Panel.vue'\n`)
  write(root, 'src/components/Table/Table.vue', `<template><table class="w-full t-table"></table></template>\n`)
  write(root, 'src/components/Table/index.ts', `export { default as Table } from './Table.vue'\n`)
  write(root, 'src/index.ts', `export * from './components/Card/index.ts'\nexport * from './components/Panel/index.ts'\nexport * from './components/Table/index.ts'\nexport const KIT_SIZES = ['kit-size-s', 'kit-size-m']\n`)

  const url = (name: string): string => pathToFileURL(join(root, `src/components/${name}/config.ts`)).href
  const provider = defineGranumProvider({
    id: '@t/kit',
    contractVersion: 2,
    components: [
      defineGranumComponent(url('Card'), { name: 'Card', safelist: ['shadow-legacy'] }),
      defineGranumComponent(url('Panel'), { name: 'Panel', dependencies: ['Card'] }),
      defineGranumComponent(url('Table'), { name: 'Table' }),
    ],
    theme: { tokensCss: 'theme/tokens.css', defaultTheme: 'kit', catalog: { kit: { title: 'Kit', data: 'themes/kit.json' }, slab: { title: 'Slab', data: 'themes/slab.json' } } },
  })
  await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), granumProvider({ provider, engine: testEngine(), log: () => {} })], build: { minify: false, rolldownOptions: { external: ['vue'] } } })
  return root
}

/**
 * Второй провайдер — с именами, которые `virtual:granum/components` не может
 * реэкспортировать: `Card` уже есть у `@t/kit`, а `date-picker` не является
 * идентификатором JS, хотя контракт его допускает.
 */
async function buildDashProvider(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'granum-app-dash-'))
  write(root, 'package.json', JSON.stringify({
    name: '@t/dash',
    version: '1.0.0',
    type: 'module',
    exports: { './granum.manifest.json': './dist/granum.manifest.json', './components/Card': './dist/components/Card/index.js', './components/date-picker': './dist/components/date-picker/index.js' },
  }))
  write(root, 'src/components/Card/Card.vue', `<template><div class="d-card"><slot /></div></template>\n`)
  write(root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\n`)
  write(root, 'src/components/date-picker/date-picker.vue', `<template><input class="d-date"></template>\n`)
  write(root, 'src/components/date-picker/index.ts', `export { default as DatePicker } from './date-picker.vue'\n`)

  const url = (name: string): string => pathToFileURL(join(root, `src/components/${name}/config.ts`)).href
  const provider = defineGranumProvider({
    id: '@t/dash',
    contractVersion: 1,
    components: [
      defineGranumComponent(url('Card'), { name: 'Card' }),
      defineGranumComponent(url('date-picker'), { name: 'date-picker' }),
    ],
  })
  await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), granumProvider({ provider, engine: testEngine(), log: () => {} })], build: { minify: false, rolldownOptions: { external: ['vue'] } } })
  return root
}

async function buildApp(providerRoot: string, config: Omit<GranumConfig, 'providers' | 'engine' | 'appSources'> & { providers?: GranumConfig['providers'], engine?: GranumConfig['engine'], appSources?: GranumConfig['appSources'] | undefined }, appCode: string, entry = `import 'virtual:granum.css'`, reuseRoot?: string, vite: Pick<InlineConfig, 'build' | 'css'> = {}) {
  // `reuseRoot` — для второй сборки ТОГО ЖЕ приложения: без него не проверить,
  // что плагин не переписывает файлы, которые не менялись.
  const root = reuseRoot ?? mkdtempSync(join(tmpdir(), 'granum-app-'))
  mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
  if (!existsSync(join(root, 'node_modules/@t/kit')))
    symlinkSync(providerRoot, join(root, 'node_modules/@t/kit'), 'dir')
  // vue резолвится из корня репозитория через symlink: приложение — отдельный каталог.
  const vuePkg = join(root, 'node_modules/vue')
  if (!existsSync(vuePkg))
    symlinkSync(join(process.cwd(), '../../node_modules/vue'), vuePkg, 'dir')
  write(root, 'index.html', `<!doctype html><div id="app"></div><script type="module" src="/src/main.ts"></script>`)
  write(root, 'src/main.ts', `${entry}\nimport { createApp } from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#app')\n`)
  write(root, 'src/App.vue', appCode)
  // По умолчанию скан `src`; `appSources: undefined` — сборка без него.
  const { appSources, ...rest } = config
  const sources = 'appSources' in config ? appSources : { dirs: ['src'] }
  const logs: string[] = []
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [vue(), granum({ providers: ['@t/kit'], engine: testEngine(), modes: { names: ['light', 'dark'] }, ...rest, ...(sources ? { appSources: sources } : {}) }, { log: l => logs.push(l) })],
    build: { minify: false, ...vite.build },
    ...(vite.css ? { css: vite.css } : {}),
  })
  const assets = join(root, 'dist/assets')
  const files = readdirSync(assets)
  const cssFiles = files.filter(f => f.endsWith('.css')).sort()
  const css = cssFiles.map(f => readFileSync(join(assets, f), 'utf8')).join('\n')
  const js = files.filter(f => f.endsWith('.js')).map(f => readFileSync(join(assets, f), 'utf8')).join('\n')
  const reportPath = join(root, 'dist/granum-report.json')
  return {
    root,
    css,
    js,
    cssFiles,
    cssOf: (file: string) => readFileSync(join(assets, file), 'utf8'),
    html: readFileSync(join(root, 'dist/index.html'), 'utf8'),
    report: existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : undefined,
    logs,
  }
}

/**
 * Провайдер с составным компонентом: `XList` реэкспортирует часть `XListItem`, а
 * `exports` ведёт её подпуть в модуль владельца — как `codegen --subcomponents`.
 */
async function buildListProvider(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'granum-app-list-'))
  write(root, 'package.json', JSON.stringify({
    name: '@t/list',
    version: '1.0.0',
    type: 'module',
    exports: {
      '.': './dist/index.js',
      './granum.manifest.json': './dist/granum.manifest.json',
      './components/XList': './dist/components/XList/index.js',
      './components/XListItem': './dist/components/XList/index.js',
      './components/XNote': './dist/components/XNote/index.js',
    },
  }))
  write(root, 'src/components/XList/XList.vue', `<template><ul class="x-list"><slot /></ul></template>\n<style>.x-list{margin:0}</style>\n`)
  write(root, 'src/components/XList/XListItem.vue', `<template><li class="x-list-item"><slot /></li></template>\n`)
  write(root, 'src/components/XList/index.ts', `export { default as XList } from './XList.vue'\nexport { default as XListItem } from './XListItem.vue'\n`)
  write(root, 'src/components/XNote/XNote.vue', `<template><p class="x-note"><slot /></p></template>\n`)
  write(root, 'src/components/XNote/index.ts', `export { default as XNote } from './XNote.vue'\n`)
  write(root, 'src/index.ts', `export * from './components/XList/index.ts'\nexport * from './components/XNote/index.ts'\n`)

  const url = (name: string): string => pathToFileURL(join(root, `src/components/${name}/config.ts`)).href
  const provider = defineGranumProvider({
    id: '@t/list',
    contractVersion: 1,
    components: [defineGranumComponent(url('XList'), { name: 'XList' }), defineGranumComponent(url('XNote'), { name: 'XNote' })],
  })
  await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), granumProvider({ provider, engine: testEngine(), log: () => {} })], build: { minify: false, rolldownOptions: { external: ['vue'] } } })
  return root
}

describe('granum() с настоящим Vite', async () => {
  const providerRoot = await buildProvider()

  it('cSS со слоями из манифеста, компонент по селекции, утилиты приложения, отчёт', async () => {
    const app = await buildApp(providerRoot, { components: ['@t/kit:Panel'], pruneTokens: { mode: 'on' } }, `<script setup lang="ts">import { Panel } from '@t/kit/components/Panel'</script><template><Panel class="mx-auto"/></template>`)
    expect(app.css).toContain('@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities')
    expect(app.css).toContain('--t-space')
    expect(app.css).not.toContain('--t-unused')
    expect(app.css).toContain('.t-card')
    expect(app.css).not.toContain('.t-table')
    expect(app.css).toContain('.p-4{padding:1rem')
    expect(app.css).toContain('.mx-auto{')
    expect(app.css).toContain('--t-bg: #fff')
    expect(app.css).toContain('[data-theme="kit-dark"] {\n  color-scheme: dark;\n  --t-bg: #000;')
    expect(app.report?.selection.map((s: { key: string }) => s.key)).toEqual(['@t/kit:Card', '@t/kit:Panel'])
    expect(app.report?.classes.unmatched).toEqual([{ className: 'shadow-legacy', sources: ['@t/kit:Card'] }])
    expect(app.report?.prune.removable).toEqual(['t-unused'])
    // Размеры слоёв — по блокам @layer собранного ассета; эмиссия лежит рядом.
    expect(app.report?.sizesSource).toBe('bundle')
    expect(app.report?.sizes.utilities.raw).toBeGreaterThan(0)
    // Сборка теста без минификации, поэтому блок бандла с обёрткой `@layer …{}` не меньше эмиссии слоя.
    expect(app.report?.sizes.components.raw).toBeGreaterThan(0)
    expect(app.report?.emissionSizes.total.raw).toBeGreaterThan(0)
    // Итог сборки — предпоследняя строка: последняя несёт время фаз.
    expect(app.logs.at(-2)).toMatch(/2 components/)
    expect(app.logs.at(-1)).toMatch(/^time \d+ ms \(prepare \d+ \[manifests \d+, scan \d+, resolve \d+\], emit \d+, report \d+\)$/)
  })

  it('virtual:granum/components реэкспортирует селекцию, virtual:granum/themes отдаёт манифест', async () => {
    const app = await buildApp(
      providerRoot,
      { components: ['@t/kit:Card'], report: { file: false } },
      `<script setup lang="ts">import { Card } from 'virtual:granum/components'; import themes from 'virtual:granum/themes'; (globalThis as any).__themes = themes</script><template><Card/></template>`,
      `import 'virtual:granum.css'`,
    )
    expect(app.js).toContain('t-card')
    // Бандлер печатает объект манифеста литералом со своим форматированием — ищем ключи.
    expect(app.js).toContain('kit-dark')
    expect(app.js).toContain('activation')
    expect(app.report).toBeUndefined()
  })

  /**
   * Имена реэкспортов зависят от селекции, а не от пакета, поэтому амбиентным
   * `d.ts` их не выразить: точные объявления пишет плагин. Запись только
   * при изменении — иначе dev-сервер дёргал бы watcher на каждый перезапуск.
   */
  it('js.dts: объявления пишутся по селекции и только при изменении', async () => {
    const app = await buildApp(
      providerRoot,
      { components: ['@t/kit:Card'], js: { dts: 'src/granum.d.ts' } },
      `<script setup lang="ts">import { Card } from 'virtual:granum/components'</script><template><Card/></template>`,
    )
    const file = join(app.root, 'src/granum.d.ts')
    const written = readFileSync(file, 'utf8')

    expect(written).toContain('declare module \'virtual:granum/components\'')
    expect(written).toContain('export { Card } from \'@t/kit/components/Card\'')
    // Невыбранный компонент в объявлениях не появляется: их предмет — селекция.
    expect(written).not.toContain('Panel')
    expect(app.logs.some(l => l.startsWith('types: '))).toBe(true)

    // Повторная сборка ТОГО ЖЕ приложения файл не трогает: селекция та же.
    const before = statSync(file).mtimeMs
    const again = await buildApp(
      providerRoot,
      { components: ['@t/kit:Card'], js: { dts: 'src/granum.d.ts' } },
      `<script setup lang="ts">import { Card } from 'virtual:granum/components'</script><template><Card/></template>`,
      undefined,
      app.root,
    )
    expect(statSync(file).mtimeMs).toBe(before)
    expect(again.logs.some(l => l.startsWith('types: '))).toBe(false)

    // А смена селекции — трогает: иначе объявления разошлись бы с модулем.
    const widened = await buildApp(
      providerRoot,
      { components: ['@t/kit:Card', '@t/kit:Panel'], js: { dts: 'src/granum.d.ts' } },
      `<script setup lang="ts">import { Card } from 'virtual:granum/components'</script><template><Card/></template>`,
      undefined,
      app.root,
    )
    expect(readFileSync(file, 'utf8')).toContain('Panel')
    expect(widened.logs.some(l => l.startsWith('types: '))).toBe(true)
  })

  /**
   * Реэкспорт по имени возможен не для каждого компонента селекции: `date-picker`
   * идентификатором не является, а `Card` выбран у двух провайдеров. Раньше
   * модуль из-за них не разбирался вовсе, и падала сборка любого приложения,
   * импортирующего из него хоть что-то.
   */
  it('имя не идентификатор и имя у двух провайдеров не реэкспортируются, а называются', async () => {
    const dashRoot = await buildDashProvider()
    const root = mkdtempSync(join(tmpdir(), 'granum-app-'))
    mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
    symlinkSync(dashRoot, join(root, 'node_modules/@t/dash'), 'dir')

    const app = await buildApp(
      providerRoot,
      {
        providers: ['@t/kit', '@t/dash'],
        components: ['@t/kit:Panel', '@t/dash:Card', '@t/dash:date-picker'],
        js: { dts: 'src/granum.d.ts' },
        report: { file: false },
      },
      `<script setup lang="ts">import { Panel } from 'virtual:granum/components'</script><template><Panel/></template>`,
      undefined,
      root,
    )

    expect(app.js).toContain('flex gap-2')
    const written = readFileSync(join(root, 'src/granum.d.ts'), 'utf8')
    expect(written).toContain('export { Panel } from \'@t/kit/components/Panel\'')
    expect(written).not.toContain('Card')
    expect(written).not.toContain('date-picker')
    // По строке на имя и один раз за сборку, хотя модулем пользуются и `load`, и `js.dts`.
    expect(app.logs.filter(l => l.includes('virtual:granum/components'))).toEqual([
      'warning: virtual:granum/components does not re-export \'Card\' — it is selected from @t/kit and @t/dash; import it from the package subpath',
      'warning: virtual:granum/components does not re-export \'date-picker\' — not a JavaScript identifier; import it from \'@t/dash/components/date-picker\'',
    ])
  })

  it('срезы по слоям загружаются отдельными модулями', async () => {
    const app = await buildApp(providerRoot, { components: ['@t/kit:Card'] }, `<template><div/></template>`, `import 'virtual:granum/layers/tokens.css'\nimport 'virtual:granum/layers/components.css'`)
    expect(app.css).toContain('--t-space')
    expect(app.css).toContain('.t-card')
    expect(app.css).not.toContain('.p-4{')
  })

  describe('css.previews: лист превью отдельно', () => {
    const PREVIEW = '[data-theme="slab-dark"]'
    const count = (css: string, text: string): number => css.split(text).length - 1

    it('по умолчанию превью — в общем листе, модуль превью пуст', async () => {
      const app = await buildApp(providerRoot, { components: ['@t/kit:Card'], previews: ['slab'] }, `<template><div/></template>`, `import 'virtual:granum.css'\nimport 'virtual:granum/previews.css'`)
      expect(count(app.css, PREVIEW)).toBe(1)
    })

    it('separate: в общем листе превью нет, оно в своём модуле — в слое themes, с порядком слоёв', async () => {
      const shared = await buildApp(providerRoot, { components: ['@t/kit:Card'], previews: ['slab'], css: { previews: 'separate' } }, `<template><div/></template>`)
      expect(shared.css).not.toContain('slab-')
      expect(shared.css).toContain('[data-theme="kit-dark"]')

      const sheet = await buildApp(providerRoot, { components: ['@t/kit:Card'], previews: ['slab'], css: { previews: 'separate' } }, `<template><div/></template>`, `import 'virtual:granum/previews/slab.css'`)
      expect(sheet.css).toContain('@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities')
      expect(sheet.css).toMatch(/@layer granum\.themes \{[\s\S]*\[data-theme="slab-dark"\]/)
      expect(sheet.css).not.toContain('kit-dark')
    })

    it('тема не из previews — ошибка сборки с перечнем превью', async () => {
      await expect(buildApp(providerRoot, { components: ['@t/kit:Card'], previews: ['slab'], css: { previews: 'separate' } }, `<template><div/></template>`, `import 'virtual:granum/previews/kit.css'`))
        .rejects
        .toThrow(/'kit' is not a preview theme of this build \(previews: slab\)/)
    })
  })

  it('срез слоя обёрнут в свой @layer, а не отдаёт голое тело', async () => {
    const app = await buildApp(providerRoot, { components: ['@t/kit:Card'] }, `<template><div/></template>`, `import 'virtual:granum/layers/components.css'`)
    // Без обёртки срез отдавал бы нелейерный CSS — ровно наоборот тому, что
    // обещает слой: он перебивал бы утилиты приложения вместо обратного.
    expect(app.css).toContain('@layer granum.components {')
    expect(app.css).toContain('.t-card')
  })

  describe('css.split: отдельный ассет на слой', () => {
    it('ассет на каждый непустой слой, ссылки в порядке слоёв, объявление порядка одно', async () => {
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'], modes: { names: ['light', 'dark'] }, css: { split: true } },
        `<template><div class="p-4"/></template>`,
      )
      const layerFiles = app.cssFiles.filter(f => /^granum\.[a-z]+-/.test(f))
      const order = layerFiles.map(f => /^granum\.([a-z]+)-/.exec(f)![1]!)
      /*
       * Ассет только у непустого слоя: у фикстуры нет `base.css`, поэтому слоёв
       * четыре из пяти — и запроса за пустым файлом быть не должно.
       */
      expect([...order].sort()).toEqual(['components', 'themes', 'tokens', 'utilities'])

      // Порядок ссылок и есть порядок каскада.
      const linked = [...app.html.matchAll(/granum\.([a-z]+)-[\w-]+\.css/g)].map(m => m[1])
      expect(linked).toEqual(['tokens', 'themes', 'components', 'utilities'])

      // Объявление порядка — ровно в одном файле, и это не ассет слоя.
      const declaring = app.cssFiles.filter(f => /@layer granum\.tokens\s*,/.test(app.cssOf(f)))
      expect(declaring.length).toBe(1)
      expect(declaring[0]!.startsWith('granum.')).toBe(false)

      // Каждый ассет несёт только свой слой.
      for (const file of layerFiles) {
        const layer = /^granum\.([a-z]+)-/.exec(file)![1]!
        const css = app.cssOf(file)
        expect(css).toContain(`@layer granum.${layer} {`)
        for (const other of ['tokens', 'base', 'themes', 'components', 'utilities'].filter(l => l !== layer))
          expect(css).not.toContain(`@layer granum.${other} {`)
      }
    })

    it('ассет слоя проходит CSS-конвейер Vite: PostCSS и минификация', async () => {
      // Метка, которую ставит PostCSS-плагин из конфига Vite: без конвейера её
      // нет. С декларацией — пустое правило минификатор выбросил бы.
      const mark = { postcssPlugin: 'granum-test-mark', Once(root: { append: (css: string) => void }) {
        root.append('.postcss-ran{color:red}')
      } }
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'], css: { split: true } },
        `<template><div class="p-4"/></template>`,
        undefined,
        undefined,
        { build: { minify: true }, css: { postcss: { plugins: [mark as never] } } },
      )
      const tokens = app.cssFiles.find(f => f.startsWith('granum.tokens-'))!
      expect(tokens).toBeDefined()
      const css = app.cssOf(tokens)
      expect(css).toContain('@layer granum.tokens{')
      expect(css).not.toContain('\n  ')
      expect(app.cssFiles.filter(f => f.startsWith('granum.')).every(f => app.cssOf(f).includes('.postcss-ran'))).toBe(true)
    })

    it('без build.cssCodeSplit — предупреждение и один файл', async () => {
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'], css: { split: true } },
        `<template><div class="p-4"/></template>`,
        undefined,
        undefined,
        { build: { cssCodeSplit: false } },
      )
      expect(app.cssFiles.filter(f => f.startsWith('granum.'))).toEqual([])
      expect(app.css).toContain('@layer granum.tokens {')
      expect(app.logs.join('\n')).toContain('css.split needs build.cssCodeSplit')
    })

    it('без split — один ассет со всеми слоями', async () => {
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'], modes: { names: ['light', 'dark'] } },
        `<template><div class="p-4"/></template>`,
      )
      expect(app.cssFiles.filter(f => f.startsWith('granum.'))).toEqual([])
      expect(app.css).toContain('@layer granum.tokens {')
      expect(app.css).toContain('@layer granum.components {')
    })
  })

  describe('appSources не задан — сборка предупреждает', () => {
    const markup = `<template><div class="uppercase">x</div></template>\n`

    it('без appSources разметка не сканируется, и строка сборки говорит об этом один раз', async () => {
      const app = await buildApp(providerRoot, { components: ['@t/kit:Card'], appSources: undefined }, markup)
      expect(app.css).not.toContain('.uppercase')
      expect(app.logs.filter(l => l.includes('appSources is not set'))).toHaveLength(1)
      expect(app.report.warnings).toContain('app-sources-unset')
    })

    it('appSources со списком каталогов и явный отказ dirs: [] — без предупреждения', async () => {
      const scanned = await buildApp(providerRoot, { components: ['@t/kit:Card'] }, markup)
      expect(scanned.css).toContain('.uppercase')
      const optedOut = await buildApp(providerRoot, { components: ['@t/kit:Card'], appSources: { dirs: [] } }, markup)
      for (const app of [scanned, optedOut]) {
        expect(app.logs.some(l => l.includes('appSources'))).toBe(false)
        expect(app.report.warnings).not.toContain('app-sources-unset')
      }
    })
  })

  describe('класс разметки приложения без правила — в unmatched', () => {
    it('опечатка в атрибуте — в unmatched с файлом; свой CSS приложения и текст разметки — нет', async () => {
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'] },
        `<template><div class="p-4 p-44x app-own">plain words here</div></template>\n<style>.app-own{color:red}</style>\n`,
      )
      const fromMarkup = app.report.classes.unmatched.filter((u: { sources: string[] }) => u.sources.includes('src/App.vue'))
      expect(fromMarkup).toEqual([{ className: 'p-44x', sources: ['src/App.vue'] }])
      expect(app.logs.some(l => l.includes(`${app.report.classes.unmatched.length} without a rule`))).toBe(true)
    })

    it(':class ловится; класс из CSS приложения вне appSources — нет', async () => {
      const root = mkdtempSync(join(tmpdir(), 'granum-app-markup-'))
      write(root, 'shared.css', '.shell-x{margin:0}\n')
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'] },
        `<script setup lang="ts">const big = true</script>\n<template><div class="shell-x" :class="[big ? 'p-8' : 'p-4', 'gap-zz']"/></template>\n`,
        `import 'virtual:granum.css'\nimport '../shared.css'`,
        root,
      )
      const fromMarkup = app.report.classes.unmatched.filter((u: { sources: string[] }) => u.sources.includes('src/App.vue'))
      expect(fromMarkup.map((u: { className: string }) => u.className)).toEqual(['gap-zz'])
    })

    /**
     * Лист приложения, подключённый строкой, ассетом бандла не становится, но
     * правило у приложения есть. CSS-модуль классы хеширует: литерал в разметке
     * с ними не совпадёт, и это находка.
     */
    it('класс из листа appSources, подключённого через ?raw или ?inline, — не находка; из CSS-модуля — находка', async () => {
      const root = mkdtempSync(join(tmpdir(), 'granum-app-raw-css-'))
      write(root, 'src/raw.css', '.raw-zz{color:teal}\n')
      write(root, 'src/inline.css', '.inline-zz{color:teal}\n')
      write(root, 'src/card.module.css', '.mod-zz{color:teal}\n')
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'] },
        `<template><div class="p-4 raw-zz inline-zz mod-zz nowhere-zz"/></template>\n`,
        `import 'virtual:granum.css'\nimport raw from './raw.css?raw'\nimport inline from './inline.css?inline'\nimport mod from './card.module.css'\nconsole.log(raw, inline, mod)`,
        root,
      )
      const fromMarkup = app.report.classes.unmatched.filter((u: { sources: string[] }) => u.sources.includes('src/App.vue'))
      expect(fromMarkup.map((u: { className: string }) => u.className)).toEqual(['mod-zz', 'nowhere-zz'])
    })

    it('регэксп и код в TS и в <script> SFC — не атрибут; HTML в строке — атрибут', async () => {
      const root = mkdtempSync(join(tmpdir(), 'granum-app-markup-'))
      write(root, 'src/markup-check.ts', `export const check = (s: string): boolean => /class="max-w-full px-4 leading-6/.test(s) && s.includes('tabindex="0"')\nexport const row = '<li class="str-zz">x</li>'\n`)
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'] },
        `<script setup lang="ts">const ok = (s: string) => /class="vue-zz/.test(s) && s.length > 0</script>\n<template><div class="p-4 p-44x">{{ ok('') }}</div></template>\n`,
        undefined,
        root,
      )
      const fromApp = app.report.classes.unmatched.filter((u: { sources: string[] }) => u.sources.some(s => s.startsWith('src/')))
      expect(fromApp).toEqual([
        { className: 'p-44x', sources: ['src/App.vue'] },
        { className: 'str-zz', sources: ['src/markup-check.ts'] },
      ])
    })
  })

  describe('компонент из корня пакета — ошибка guard', () => {
    /** Исходная ошибка сборки: из хука трансформации бандлер заворачивает её в свою. */
    const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
      promise.then(() => undefined, (e: unknown) => (e as { errors?: unknown[] }).errors?.[0] ?? e)

    it('компонент из корня — ошибка, даже выбранный: селекция видит его только по подпути', async () => {
      const error = await failureOf(buildApp(providerRoot, { components: ['@t/kit:Card'] }, `<script setup lang="ts">import { Card } from '@t/kit'</script><template><Card/></template>`))
      expect(error).toBeInstanceOf(ComponentRootImportError)
      expect(error).toMatchObject({ providerId: '@t/kit', components: ['Card'], whole: false, importer: 'src/App.vue' })
      expect((error as Error).message).toContain(`'@t/kit/components/Card'`)
    })

    it('корень целиком — ошибка', async () => {
      const error = await failureOf(buildApp(providerRoot, { components: ['@t/kit:Card'] }, `<script setup lang="ts">import * as kit from '@t/kit'\nconst { Card } = kit</script><template><Card/></template>`))
      expect(error).toMatchObject({ providerId: '@t/kit', whole: true })
    })

    it('прочие имена корня и импорт одних типов — можно', async () => {
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'] },
        `<script setup lang="ts">import type { Card as CardType } from '@t/kit'\nimport { KIT_SIZES } from '@t/kit'\nimport { Card } from '@t/kit/components/Card'\nconst sizes: string[] = KIT_SIZES\nconst _type: typeof CardType | undefined = undefined</script><template><Card :data-sizes="sizes.join()"/></template>`,
      )
      expect(app.js).toContain('kit-size-s')
    })

    it('guard: warn — предупреждение и сборка; off — тишина', async () => {
      const code = `<script setup lang="ts">import { Card } from '@t/kit'</script><template><Card/></template>`
      const warned = await buildApp(providerRoot, { components: ['@t/kit:Card'], js: { guard: 'warn' } }, code)
      expect(warned.logs.some(l => l.startsWith('warning:') && l.includes(`'@t/kit/components/Card'`))).toBe(true)
      const off = await buildApp(providerRoot, { components: ['@t/kit:Card'], js: { guard: 'off' } }, code)
      expect(off.logs.some(l => l.includes('package root'))).toBe(false)
    })
  })

  /**
   * Часть составного компонента живёт в модуле владельца и без его CSS
   * голая: guard, селекция `'imports'` и проверка корня судят владельца.
   */
  describe('часть составного компонента сводится к владельцу', async () => {
    const listProvider = await buildListProvider()
    const listApp = (): string => {
      const root = mkdtempSync(join(tmpdir(), 'granum-app-parts-'))
      mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
      symlinkSync(listProvider, join(root, 'node_modules/@t/list'), 'dir')
      return root
    }
    const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
      promise.then(() => undefined, (e: unknown) => (e as { errors?: unknown[] }).errors?.[0] ?? e)
    const importPart = `<script setup lang="ts">import { XListItem } from '@t/list/components/XListItem'</script>\n<template><XListItem>a</XListItem></template>\n`
    const keys = (report: { selection: { key: string }[] }): string[] => report.selection.map(entry => entry.key)

    it('подпуть части вне селекции — ошибка на владельце с названной частью; владелец в селекции — сборка с его CSS', async () => {
      const error = await failureOf(buildApp(providerRoot, { providers: ['@t/list'], components: ['@t/list:XNote'] }, importPart, undefined, listApp()))
      expect(error).toBeInstanceOf(ComponentOutsideSelectionError)
      expect(error).toMatchObject({ key: '@t/list:XList', part: 'XListItem', importer: 'src/App.vue' })
      expect((error as Error).message).toContain(`through its part 'XListItem'`)

      const app = await buildApp(providerRoot, { providers: ['@t/list'], components: ['@t/list:XList'] }, importPart, undefined, listApp())
      expect(app.css).toMatch(/\.x-list\s*\{/)
    })

    it(`components: 'imports' — импорт и тег части дают владельца и его CSS`, async () => {
      // Без тега `<XListItem>` в шаблоне: владельца даёт именно импорт.
      const byImport = await buildApp(providerRoot, { providers: ['@t/list'], components: 'imports' }, `<script setup lang="ts">import { XListItem } from '@t/list/components/XListItem'\nconst item = XListItem</script>\n<template><component :is="item">a</component></template>\n`, undefined, listApp())
      expect(keys(byImport.report)).toEqual(['@t/list:XList'])
      expect(byImport.css).toMatch(/\.x-list\s*\{/)
      const byTag = await buildApp(providerRoot, { providers: ['@t/list'], components: 'imports' }, `<template><XListItem>a</XListItem></template>\n`, undefined, listApp())
      expect(keys(byTag.report)).toEqual(['@t/list:XList'])
    })

    it('часть из корня пакета — ComponentRootImportError', async () => {
      const error = await failureOf(buildApp(providerRoot, { providers: ['@t/list'], components: ['@t/list:XList'] }, `<script setup lang="ts">import { XListItem } from '@t/list'</script>\n<template><XListItem>a</XListItem></template>\n`, undefined, listApp()))
      expect(error).toBeInstanceOf(ComponentRootImportError)
      expect(error).toMatchObject({ providerId: '@t/list', components: ['XListItem'], whole: false })
      // Совет тот же, что для компонента: подпуть части или виртуальный модуль — он
      // реэкспортирует части выбранного владельца.
      expect((error as Error).message).toContain(`Import components from '@t/list/components/XListItem' or from 'virtual:granum/components'`)
    })

    it('virtual:granum/components реэкспортирует части выбранного владельца — и в js.dts', async () => {
      const app = await buildApp(
        providerRoot,
        { providers: ['@t/list'], components: ['@t/list:XList'], js: { dts: 'src/granum.d.ts' } },
        `<script setup lang="ts">import { XList, XListItem } from 'virtual:granum/components'</script>\n<template><XList><XListItem>a</XListItem></XList></template>\n`,
        undefined,
        listApp(),
      )
      expect(readFileSync(join(app.root, 'src/granum.d.ts'), 'utf8')).toContain(`export { XListItem } from '@t/list/components/XListItem'`)
      expect(app.css).toMatch(/\.x-list\s*\{/)
    })

    it('имя части, совпавшее с выбранным компонентом другого провайдера, не реэкспортируется — с предупреждением', async () => {
      const twinRoot = mkdtempSync(join(tmpdir(), 'granum-app-twin-'))
      write(twinRoot, 'package.json', JSON.stringify({ name: '@t/twin', version: '1.0.0', type: 'module', exports: { './granum.manifest.json': './dist/granum.manifest.json', './components/XListItem': './dist/components/XListItem/index.js' } }))
      write(twinRoot, 'src/components/XListItem/XListItem.vue', `<template><li class="twin-item"><slot /></li></template>\n`)
      write(twinRoot, 'src/components/XListItem/index.ts', `export { default as XListItem } from './XListItem.vue'\n`)
      const twin = defineGranumProvider({ id: '@t/twin', contractVersion: 1, components: [defineGranumComponent(pathToFileURL(join(twinRoot, 'src/components/XListItem/config.ts')).href, { name: 'XListItem' })] })
      await build({ root: twinRoot, configFile: false, logLevel: 'silent', plugins: [vue(), granumProvider({ provider: twin, engine: testEngine(), indexEntry: false, log: () => {} })], build: { minify: false, rolldownOptions: { external: ['vue'] } } })
      const root = listApp()
      symlinkSync(twinRoot, join(root, 'node_modules/@t/twin'), 'dir')
      const app = await buildApp(
        providerRoot,
        { providers: ['@t/list', '@t/twin'], components: ['@t/list:XList', '@t/twin:XListItem'], js: { dts: 'src/granum.d.ts' } },
        `<script setup lang="ts">import { XList } from 'virtual:granum/components'</script>\n<template><XList>a</XList></template>\n`,
        undefined,
        root,
      )
      expect(readFileSync(join(app.root, 'src/granum.d.ts'), 'utf8')).not.toContain('XListItem')
      expect(app.logs).toContain(`warning: virtual:granum/components does not re-export 'XListItem' — it is selected from @t/list and @t/twin; import it from the package subpath`)
    })
  })

  it('импорт компонента вне селекции — ошибка; guard: warn — предупреждение; imports — попадает в селекцию', async () => {
    const code = `<script setup lang="ts">import { Table } from '@t/kit/components/Table'</script><template><Table/></template>`
    // Ошибку из `resolveId` бандлер заворачивает в свою; исходная лежит в `errors[0]`.
    const failure = await buildApp(providerRoot, { components: ['@t/kit:Card'] }, code).then(() => undefined, (e: unknown) => e as { errors?: unknown[] })
    expect(failure).toBeDefined()
    const original = failure?.errors?.[0] ?? failure
    expect(original).toBeInstanceOf(ComponentOutsideSelectionError)
    expect((original as ComponentOutsideSelectionError).key).toBe('@t/kit:Table')
    const warned = await buildApp(providerRoot, { components: ['@t/kit:Card'], js: { guard: 'warn' } }, code)
    expect(warned.logs.some(l => l.includes('@t/kit:Table'))).toBe(true)
    const byImports = await buildApp(providerRoot, { components: 'imports' }, code)
    // `t-table` — хук-класс без правила и без CSS; доказательство селекции — утилита шаблона.
    expect(byImports.css).toContain('.w-full{')
    expect(byImports.report?.selection.map((s: { key: string }) => s.key)).toEqual(['@t/kit:Table'])
  })

  it('плоский режим без @layer', async () => {
    const app = await buildApp(providerRoot, { components: ['@t/kit:Card'], css: { layers: false } }, `<template><div/></template>`)
    expect(app.css).not.toContain('@layer')
    expect(app.css).toContain('.t-card')
  })

  /**
   * Хост вправе собрать несколько окружений Vite одним билдом: Astro строит
   * `prerender`, `ssr` и `client`, разрешая конфиг каждого ДО первой сборки и
   * вызывая финальные хуки на каждое. Настоящего такого хоста среди стендов
   * нет, поэтому окружения имитируются прямым вызовом хуков.
   */
  describe('многосредовая сборка хоста', () => {
    interface Hooks {
      configResolved: (config: unknown) => void
      generateBundle: (this: { environment: { name: string, config: { consumer: 'client' | 'server' } } }, options: unknown, bundle: unknown) => void
      closeBundle: () => Promise<void>
    }

    /** Каталог приложения для настоящих сборок: провайдер и vue — симлинками. */
    function appRoot(): string {
      const root = mkdtempSync(join(tmpdir(), 'granum-instance-'))
      mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
      symlinkSync(providerRoot, join(root, 'node_modules/@t/kit'), 'dir')
      symlinkSync(join(process.cwd(), '../../node_modules/vue'), join(root, 'node_modules/vue'), 'dir')
      write(root, 'index.html', `<!doctype html><div id="app"></div><script type="module" src="/src/main.ts"></script>`)
      write(root, 'src/main.ts', `import 'virtual:granum.css'\nimport { createApp } from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#app')\n`)
      write(root, 'src/App.vue', `<template><div class="mx-auto"/></template>`)
      return root
    }

    const appConfig = { providers: ['@t/kit'], engine: testEngine(), appSources: { dirs: ['src'] }, components: ['@t/kit:Card'] }

    /**
     * Инстанс держит состояние одной сборки: резолюцию, эмиссию, «отчёт
     * написан». Во второй отдельной сборке он отдал бы чужие резолюцию и CSS и
     * не написал бы отчёт — поэтому повтор отвергается.
     */
    it('тот же инстанс во второй отдельной сборке — ошибка с обоими каталогами', async () => {
      const root = appRoot()
      const plugin = granum(appConfig, { log: () => {} })
      const once = (outDir: string): ReturnType<typeof build> => build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), plugin], build: { minify: false, outDir } })

      await once('dist/client')
      expect(existsSync(join(root, 'dist/client/granum-report.json'))).toBe(true)
      await expect(once('dist/server')).rejects.toMatchObject({
        code: 'plugin-instance-reused',
        message: expect.stringMatching(/dist\/client.*dist\/server/s),
      })
    })

    /**
     * Окружения одного builder Vite — одна сборка: Vite разрешает конфиги всех
     * окружений до первой из них. Так собирает Astro, и разные `outDir` там законны.
     */
    it('окружения одного builder Vite делят инстанс: разные outDir — не ошибка', async () => {
      const root = appRoot()
      write(root, 'src/entry-server.ts', `export const ssr = true\n`)
      const logs: string[] = []
      const plugin = granum(appConfig, { log: line => logs.push(line) })
      const builder = await createBuilder({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [vue(), plugin],
        environments: {
          client: { build: { minify: false, outDir: 'dist/client' } },
          ssr: { build: { minify: false, outDir: 'dist/server', rolldownOptions: { input: join(root, 'src/entry-server.ts') } } },
        },
        builder: {},
      })
      await builder.buildApp()

      const reports = ['dist/client', 'dist/server'].filter(dir => existsSync(join(root, dir, 'granum-report.json')))
      expect(reports).toHaveLength(1)
      expect(logs.filter(line => /components, /.test(line))).toHaveLength(1)
    })

    it('отчёт пишется один раз, в каталог разрешённого конфига, по бандлу с CSS', async () => {
      const root = mkdtempSync(join(tmpdir(), 'granum-multienv-'))
      mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
      symlinkSync(providerRoot, join(root, 'node_modules/@t/kit'), 'dir')
      write(root, 'src/App.vue', `<template><div class="mx-auto"/></template>`)

      const logs: string[] = []
      const hooks = granum(
        { providers: ['@t/kit'], engine: testEngine(), appSources: { dirs: ['src'] }, components: ['@t/kit:Card'] },
        { log: line => logs.push(line) },
      ) as unknown as Hooks

      // Конфиги всех окружений разрешаются до сборок; побеждает последний.
      for (const outDir of ['dist', 'dist/.prerender', 'dist', 'dist'])
        hooks.configResolved({ root, base: '/', command: 'build', build: { outDir, ssr: true } })

      // Первое окружение несёт CSS, второе — только JS.
      hooks.generateBundle.call({ environment: { name: 'prerender', config: { consumer: 'server' } } }, {}, { 'a.css': { type: 'asset', fileName: 'a.css', source: '@layer granum.utilities{.mx-auto{margin:0 auto}}' } })
      await hooks.closeBundle()
      hooks.generateBundle.call({ environment: { name: 'ssr', config: { consumer: 'server' } } }, {}, { 'b.js': { type: 'chunk', fileName: 'b.js', code: '' } })
      await hooks.closeBundle()

      // Во временный каталог окружения отчёт не уезжает: хост его удаляет.
      expect(existsSync(join(root, 'dist/.prerender/granum-report.json'))).toBe(false)
      const report = JSON.parse(readFileSync(join(root, 'dist/granum-report.json'), 'utf8'))
      // Размеры сняты с того окружения, в котором CSS был.
      expect(report.sizesSource).toBe('bundle')
      expect(report.sizes.utilities.raw).toBeGreaterThan(0)
      // Две строки — итог и время, а не по паре на окружение.
      expect(logs).toHaveLength(2)
      expect(logs[0]).toMatch(/1 components/)
    })

    /**
     * Порядок окружений задаёт хост: Astro с `output: 'server'` собирает сервер
     * раньше клиента. Отчёт обязан быть одним и тем же при любом порядке.
     */
    it('отчёт не зависит от порядка окружений: CSS всех окружений, каталог клиента', async () => {
      const texts: string[] = []
      for (const order of [['ssr', 'client'], ['client', 'ssr']] as const) {
        const root = appRoot()
        write(root, 'src/App.vue', `<template><p class="app-note mx-auto"/></template>`)
        write(root, 'src/app.css', `.app-note{color:teal}\n`)
        write(root, 'src/main.ts', `import 'virtual:granum.css'\nimport './app.css'\nimport { createApp } from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#app')\n`)
        // Серверный вход без CSS: так выглядит первое окружение у Astro на сервере.
        write(root, 'src/entry-server.ts', `export const html = '<p class="app-note">ok</p>'\n`)
        const environments = {
          // Имя `ssr`: окружение с ним заводит и плагин Vue, без входа оно не соберётся.
          ssr: { consumer: 'server' as const, build: { minify: false, outDir: 'dist/server', ssr: true, rolldownOptions: { input: join(root, 'src/entry-server.ts') } } },
          client: { consumer: 'client' as const, build: { minify: false, outDir: 'dist/client' } },
        }
        const logs: string[] = []
        const builder = await createBuilder({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [vue(), granum(appConfig, { log: line => logs.push(line) })],
          environments: Object.fromEntries(order.map(name => [name, environments[name]])),
          builder: {},
        })
        await builder.buildApp()

        expect(existsSync(join(root, 'dist/server/granum-report.json'))).toBe(false)
        const text = readFileSync(join(root, 'dist/client/granum-report.json'), 'utf8')
        const report = JSON.parse(text)
        expect(report.classes.unmatched.map((u: { className: string }) => u.className)).not.toContain('app-note')
        expect(report.sizesSource).toBe('bundle')
        // Строка сборки печатается заново, если итог изменился: последняя — итог.
        expect(logs.filter(line => /without a rule/.test(line)).at(-1)).toContain(`${report.classes.unmatched.length} without a rule`)
        texts.push(text)
      }
      expect(texts[1]).toBe(texts[0])
    })

    /**
     * Серверный вход, который CSS не импортирует, даёт бандл без CSS-ассетов: о
     * CSS приложения он ничего не знает, и судить разметку по нему нельзя.
     */
    it('отдельная сборка без CSS-ассетов классы разметки не судит', async () => {
      const root = appRoot()
      write(root, 'src/App.vue', `<template><div class="app-own mx-auto"/></template>\n<style>.app-own{color:red}</style>\n`)
      write(root, 'src/entry-server.ts', `export const html = '<div class="app-own">ok</div>'\n`)
      await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), granum(appConfig, { log: () => {} })], build: { minify: false, ssr: 'src/entry-server.ts', outDir: 'dist/server' } })
      const report = JSON.parse(readFileSync(join(root, 'dist/server/granum-report.json'), 'utf8'))
      expect(report.classes.unmatched.map((u: { className: string }) => u.className)).not.toContain('app-own')
    })
  })
})

/**
 * Провайдер без компонентов, только с правилами движка: так приложение выносит
 * свои правила из фабрики движка и сохраняет быстрый путь.
 */
describe('провайдер только с правилами движка', async () => {
  const packageRoot = mkdtempSync(join(tmpdir(), 'granum-rules-only-'))
  write(packageRoot, 'package.json', JSON.stringify({ name: '@t/rules', version: '1.0.0', type: 'module', exports: { './granum.manifest.json': './dist/granum.manifest.json' } }))
  write(packageRoot, 'src/engine.ts', `export default { rules: [['rule-only', { color: 'red' }]] }\n`)
  const provider = defineGranumProvider({ id: '@t/rules', contractVersion: 1, components: [], engine: { dialect: TEST_DIALECT, rules: [['rule-only', { color: 'red' }]] } })
  await build({
    root: packageRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [granumProvider({ provider, engine: testEngine(), indexEntry: false, entries: { engine: 'src/engine.ts' }, engineModule: 'engine.js', log: () => {} })],
    build: { minify: false },
  })

  async function buildRulesApp(engine: GranumConfig['engine']): Promise<{ css: string, report: { providers: { id: string, rulesLoaded: boolean, classes: string, reason: string }[] } }> {
    const root = mkdtempSync(join(tmpdir(), 'granum-rules-app-'))
    mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
    symlinkSync(packageRoot, join(root, 'node_modules/@t/rules'), 'dir')
    symlinkSync(join(process.cwd(), '../../node_modules/vue'), join(root, 'node_modules/vue'), 'dir')
    write(root, 'index.html', `<!doctype html><div id="app"></div><script type="module" src="/src/main.ts"></script>`)
    write(root, 'src/main.ts', `import 'virtual:granum.css'\nimport { createApp } from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#app')\n`)
    write(root, 'src/App.vue', `<template><div class="rule-only p-4"/></template>\n`)
    await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), granum({ engine, providers: ['@t/rules'], appSources: { dirs: ['src'] } }, { log: () => {} })], build: { minify: false } })
    const assets = join(root, 'dist/assets')
    return {
      css: readdirSync(assets).filter(f => f.endsWith('.css')).map(f => readFileSync(join(assets, f), 'utf8')).join('\n'),
      report: JSON.parse(readFileSync(join(root, 'dist/granum-report.json'), 'utf8')),
    }
  }

  it('манифест: компонентов нет, отпечаток — движка сборки, правила — модулем', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'dist/granum.manifest.json'), 'utf8'))
    expect(manifest.components).toEqual({})
    expect(manifest.engine).toMatchObject({ dialect: TEST_DIALECT, vocabulary: testEngine().vocabulary, module: 'engine.js' })
    expect(manifest.warnings).toEqual([])
  })

  it('приложение того же диалекта на ванильном движке получает правило, пересчёта нет', async () => {
    const app = await buildRulesApp(testEngine())
    expect(app.css).toContain('.rule-only')
    expect(app.css).toMatch(/\.rule-only\s*\{\s*color:\s*red/)
    expect(app.report.providers[0]).toMatchObject({ id: '@t/rules', rulesLoaded: true, classes: 'manifest', reason: 'none' })
  })

  it('приложение чужого диалекта правила пакета не загружает', async () => {
    const app = await buildRulesApp(testEngine({ dialect: 'granum-tests/other@1' }))
    expect(app.css).not.toContain('.rule-only')
    expect(app.report.providers[0]!.rulesLoaded).toBe(false)
  })
})
