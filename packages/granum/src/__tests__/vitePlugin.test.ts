import type { GranumConfig } from '../config'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
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
  await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), granumProvider({ provider, log: () => {} })], build: { minify: false, rolldownOptions: { external: ['vue'] } } })
  return root
}

interface AppBuild { root: string, css: string, js: string, report: Record<string, any> | undefined, logs: string[] }

async function buildApp(providerRoot: string, config: Omit<GranumConfig, 'providers'> & { providers?: GranumConfig['providers'] }, appCode: string, entry = `import 'virtual:granum.css'`): Promise<AppBuild> {
  const root = mkdtempSync(join(tmpdir(), 'granum-app-'))
  mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
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
    plugins: [vue(), granum({ providers: ['@t/kit'], appSources: { dirs: ['src'] }, ...config }, { log: l => logs.push(l) })],
    build: { minify: false },
  })
  const assets = join(root, 'dist/assets')
  const files = readdirSync(assets)
  const css = files.filter(f => f.endsWith('.css')).map(f => readFileSync(join(assets, f), 'utf8')).join('\n')
  const js = files.filter(f => f.endsWith('.js')).map(f => readFileSync(join(assets, f), 'utf8')).join('\n')
  const reportPath = join(root, 'dist/granum-report.json')
  return { root, css, js, report: existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : undefined, logs }
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
    expect(app.logs.at(-1)).toMatch(/2 components/)
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

  it('срезы по слоям загружаются отдельными модулями (A-12)', async () => {
    const app = await buildApp(providerRoot, { components: ['@t/kit:Card'] }, `<template><div/></template>`, `import 'virtual:granum/layers/tokens.css'\nimport 'virtual:granum/layers/components.css'`)
    expect(app.css).toContain('--t-space')
    expect(app.css).toContain('.t-card')
    expect(app.css).not.toContain('.p-4{')
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
