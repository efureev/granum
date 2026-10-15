import type { GranumProviderPluginOptions } from '../build/plugin'
import type { GranumConfig } from '../config'
import type { GranumLoadedManifest, GranumProvider } from '../contract'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { granumProvider } from '../build/plugin'
import { defineGranumProvider } from '../contract'
import { emitCss } from '../node/emit'
import { buildReport } from '../node/report'
import { granum } from '../vite/plugin'
import { fileThemeProvider, prepareTestApp } from './helpers'
import { TEST_DIALECT, testEngine } from './testEngine'

/**
 * Пункты ТЗ портала Granularity (`docs/tz-portal-2026-10/README.md`),
 * подтверждённые на текущем коде.
 *
 * Тесты фиксируют НЫНЕШНЕЕ поведение, которое ТЗ называет дефектом. Починка
 * пункта роняет его тест — тогда тест превращается в обычный (ожидание по
 * критерию готовности ТЗ), а пункт уходит из ТЗ и из roadmap.
 */

describe('пункты ТЗ-8 и ТЗ-9: классы разметки приложения', () => {
  function appWithMarkup(): { root: string, provider: GranumLoadedManifest } {
    const setup = fileThemeProvider()
    mkdirSync(join(setup.root, 'src'), { recursive: true })
    writeFileSync(join(setup.root, 'src/App.vue'), `<template><div class="p-4 not-a-rule-xyz"/></template>\n`)
    return setup
  }

  it('8: класс разметки без правила не попадает в `unmatched`', async () => {
    const { root, provider } = appWithMarkup()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], appSources: { dirs: ['src'] } }, root)
    const css = await emitCss(app)
    expect(css.engineInput).toContain('not-a-rule-xyz')
    expect(buildReport(app, css).classes.unmatched.map(e => e.className)).not.toContain('not-a-rule-xyz')
  })

  it('9: без `appSources` разметка не сканируется, и никто об этом не говорит', async () => {
    const { root, provider } = appWithMarkup()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'] }, root)
    expect(app.appScan.classes).toEqual([])
    expect(app.warnings).toEqual([])
    expect((await emitCss(app)).layers.utilities).not.toContain('.p-4')
  })
})

/** Файл во временном пакете. */
function put(root: string, rel: string, content: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}

/** Пакет-провайдер, собранный настоящим `granumProvider`. */
async function buildPackage(root: string, provider: GranumProvider, options: Partial<GranumProviderPluginOptions> = {}): Promise<void> {
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [vue(), granumProvider({ provider, engine: testEngine(), log: () => {}, ...options })],
    build: { minify: false, rolldownOptions: { external: ['vue'] } },
  })
}

/** Приложение на собранных пакетах; возвращает CSS, отчёт и лог плагина. */
async function buildApp(packages: Record<string, string>, config: Omit<GranumConfig, 'engine'>, appVue: string) {
  const root = mkdtempSync(join(tmpdir(), 'granum-tz-app-'))
  mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
  for (const [name, dir] of Object.entries(packages))
    symlinkSync(dir, join(root, 'node_modules/@t', name), 'dir')
  symlinkSync(join(process.cwd(), '../../node_modules/vue'), join(root, 'node_modules/vue'), 'dir')
  put(root, 'index.html', `<!doctype html><div id="app"></div><script type="module" src="/src/main.ts"></script>`)
  put(root, 'src/main.ts', `import 'virtual:granum.css'\nimport { createApp } from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#app')\n`)
  put(root, 'src/App.vue', appVue)
  const logs: string[] = []
  await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), granum({ engine: testEngine(), appSources: { dirs: ['src'] }, ...config }, { log: l => logs.push(l) })], build: { minify: false } })
  const assets = join(root, 'dist/assets')
  const css = readdirSync(assets).filter(f => f.endsWith('.css')).map(f => readFileSync(join(assets, f), 'utf8')).join('\n')
  return { css, report: JSON.parse(readFileSync(join(root, 'dist/granum-report.json'), 'utf8')), logs }
}

describe('пункт ТЗ-7: провайдер только с правилами', () => {
  /**
   * Сценарий работает: пакет без компонентов с модулем правил того же
   * диалекта — правила загружаются, класс генерируется. Не хватает описания в
   * руководстве автора провайдера и фикстуры.
   */
  it('7: правила пакета без компонентов доезжают до приложения того же словаря', async () => {
    const root = mkdtempSync(join(tmpdir(), 'granum-tz-rules-'))
    const rules = [['rule-only', { color: 'red' }]] as const
    put(root, 'package.json', JSON.stringify({ name: '@t/rules', version: '1.0.0', type: 'module', exports: { './granum.manifest.json': './dist/granum.manifest.json', './engine.js': './dist/engine.js' } }))
    put(root, 'src/engine.ts', `export default { rules: [['rule-only', { color: 'red' }]] }\n`)
    await buildPackage(root, defineGranumProvider({ id: '@t/rules', contractVersion: 1, components: [], engine: { dialect: TEST_DIALECT, rules } }), { indexEntry: false, entries: { engine: 'src/engine.ts' }, engineModule: 'engine.js' })
    expect(existsSync(join(root, 'dist/engine.js'))).toBe(true)

    const app = await buildApp({ rules: root }, { providers: ['@t/rules'] }, `<template><div class="rule-only"/></template>\n`)
    expect(app.css).toContain('.rule-only{color:red')
    expect(app.report.providers[0]).toMatchObject({ id: '@t/rules', rulesLoaded: true, reason: 'none' })
  })
})
