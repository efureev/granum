import type { GranumConfig } from '../config'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { granumProvider } from '../build/plugin'
import { defineGranumComponent, defineGranumProvider } from '../contract'
import { ComponentOutsideSelectionError } from '../core/errors'
import { granum } from '../vite/plugin'
import { testEngine } from './testEngine'

/**
 * Сквозная интеграция (A-2…A-20): провайдер собирается плагином `granumProvider`
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
  write(root, 'src/theme/dark.css', '.dark{--t-bg:#000}')
  write(root, 'src/components/Card/Card.vue', `<template><div class="t-card p-4 bg-[var(--t-bg)]"><slot /></div></template>\n<style>.t-card{gap:var(--t-space)}</style>\n`)
  write(root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\n`)
  write(root, 'src/components/Panel/Panel.vue', `<script setup lang="ts">\nimport { Card } from '../Card/index.ts'\n</script>\n<template><section class="flex gap-2"><Card /></section></template>\n`)
  write(root, 'src/components/Panel/index.ts', `export { default as Panel } from './Panel.vue'\n`)
  write(root, 'src/components/Table/Table.vue', `<template><table class="w-full t-table"></table></template>\n`)
  write(root, 'src/components/Table/index.ts', `export { default as Table } from './Table.vue'\n`)
  write(root, 'src/index.ts', `export * from './components/Card/index.ts'\nexport * from './components/Panel/index.ts'\nexport * from './components/Table/index.ts'\n`)

  const url = (name: string): string => pathToFileURL(join(root, `src/components/${name}/config.ts`)).href
  const provider = defineGranumProvider({
    id: '@t/kit',
    contractVersion: 1,
    components: [
      defineGranumComponent(url('Card'), { name: 'Card', safelist: ['shadow-legacy'] }),
      defineGranumComponent(url('Panel'), { name: 'Panel', dependencies: ['Card'] }),
      defineGranumComponent(url('Table'), { name: 'Table' }),
    ],
    theme: { tokensCss: 'theme/tokens.css', themes: { dark: 'theme/dark.css' }, defaultThemes: ['light', 'dark'], tokenDefinitions: { light: { tokens: { 't-bg': '#fff' } } } },
  })
  await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), granumProvider({ provider, engine: testEngine(), log: () => {} })], build: { minify: false, rolldownOptions: { external: ['vue'] } } })
  return root
}

async function buildApp(providerRoot: string, config: Omit<GranumConfig, 'providers' | 'engine'> & { providers?: GranumConfig['providers'], engine?: GranumConfig['engine'] }, appCode: string, entry = `import 'virtual:granum.css'`, reuseRoot?: string) {
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
  const logs: string[] = []
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [vue(), granum({ providers: ['@t/kit'], engine: testEngine(), appSources: { dirs: ['src'] }, ...config }, { log: l => logs.push(l) })],
    build: { minify: false },
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

describe('granum() с настоящим Vite', async () => {
  const providerRoot = await buildProvider()

  it('cSS со слоями из манифеста, компонент по селекции, утилиты приложения, отчёт (A-9…A-15, A-19)', async () => {
    const app = await buildApp(providerRoot, { components: ['@t/kit:Panel'], pruneTokens: { mode: 'on' } }, `<script setup lang="ts">import { Panel } from '@t/kit/components/Panel'</script><template><Panel class="mx-auto"/></template>`)
    expect(app.css).toContain('@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities')
    expect(app.css).toContain('--t-space')
    expect(app.css).not.toContain('--t-unused')
    expect(app.css).toContain('.t-card')
    expect(app.css).not.toContain('.t-table')
    expect(app.css).toContain('.p-4{padding:1rem')
    expect(app.css).toContain('.mx-auto{')
    expect(app.css).toContain('--t-bg: #fff')
    expect(app.css).toContain('.dark{--t-bg:#000')
    expect(app.report?.selection.map((s: { key: string }) => s.key)).toEqual(['@t/kit:Card', '@t/kit:Panel'])
    expect(app.report?.classes.unmatched).toEqual([{ className: 'shadow-legacy', sources: ['@t/kit:Card'] }])
    expect(app.report?.prune.removable).toEqual(['t-unused'])
    // Размеры слоёв — по блокам @layer собранного ассета (A-19); эмиссия лежит рядом.
    expect(app.report?.sizesSource).toBe('bundle')
    expect(app.report?.sizes.utilities.raw).toBeGreaterThan(0)
    // Сборка теста без минификации, поэтому блок бандла с обёрткой `@layer …{}` не меньше эмиссии слоя.
    expect(app.report?.sizes.components.raw).toBeGreaterThan(0)
    expect(app.report?.emissionSizes.total.raw).toBeGreaterThan(0)
    // Итог сборки — предпоследняя строка: последняя несёт время фаз (N-4).
    expect(app.logs.at(-2)).toMatch(/2 components/)
    expect(app.logs.at(-1)).toMatch(/^time \d+ ms \(prepare \d+, emit \d+, report \d+\)$/)
  })

  it('virtual:granum/components реэкспортирует селекцию, virtual:granum/themes отдаёт манифест (A-5, T-4)', async () => {
    const app = await buildApp(
      providerRoot,
      { components: ['@t/kit:Card'], report: { file: false } },
      `<script setup lang="ts">import { Card } from 'virtual:granum/components'; import themes from 'virtual:granum/themes'; (globalThis as any).__themes = themes</script><template><Card/></template>`,
      `import 'virtual:granum.css'`,
    )
    expect(app.js).toContain('t-card')
    // Бандлер печатает объект манифеста литералом со своим форматированием — ищем ключи.
    expect(app.js).toContain('defaultTheme')
    expect(app.js).toContain('activation')
    expect(app.report).toBeUndefined()
  })

  /**
   * Имена реэкспортов зависят от селекции, а не от пакета, поэтому амбиентным
   * `d.ts` их не выразить: точные объявления пишет плагин (A-5). Запись только
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

  it('срезы по слоям загружаются отдельными модулями (A-12)', async () => {
    const app = await buildApp(providerRoot, { components: ['@t/kit:Card'] }, `<template><div/></template>`, `import 'virtual:granum/layers/tokens.css'\nimport 'virtual:granum/layers/components.css'`)
    expect(app.css).toContain('--t-space')
    expect(app.css).toContain('.t-card')
    expect(app.css).not.toContain('.p-4{')
  })

  it('срез слоя обёрнут в свой @layer, а не отдаёт голое тело (A-12, INV-CSS-4)', async () => {
    const app = await buildApp(providerRoot, { components: ['@t/kit:Card'] }, `<template><div/></template>`, `import 'virtual:granum/layers/components.css'`)
    // Без обёртки срез отдавал бы нелейерный CSS — ровно наоборот тому, что
    // обещает слой: он перебивал бы утилиты приложения вместо обратного.
    expect(app.css).toContain('@layer granum.components {')
    expect(app.css).toContain('.t-card')
  })

  describe('css.split: отдельный ассет на слой (A-21, INV-CSS-9)', () => {
    it('ассет на каждый непустой слой, ссылки в порядке слоёв, объявление порядка одно', async () => {
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'], themes: { names: ['light', 'dark'] }, css: { split: true } },
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

    it('без split — один ассет со всеми слоями', async () => {
      const app = await buildApp(
        providerRoot,
        { components: ['@t/kit:Card'], themes: { names: ['light', 'dark'] } },
        `<template><div class="p-4"/></template>`,
      )
      expect(app.cssFiles.filter(f => f.startsWith('granum.'))).toEqual([])
      expect(app.css).toContain('@layer granum.tokens {')
      expect(app.css).toContain('@layer granum.components {')
    })
  })

  it('импорт компонента вне селекции — ошибка; guard: warn — предупреждение; imports — попадает в селекцию (A-3, A-6, INV-SEL-5, INV-JS-2)', async () => {
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

  it('плоский режим без @layer (A-14)', async () => {
    const app = await buildApp(providerRoot, { components: ['@t/kit:Card'], css: { layers: false } }, `<template><div/></template>`)
    expect(app.css).not.toContain('@layer')
    expect(app.css).toContain('.t-card')
  })
})
