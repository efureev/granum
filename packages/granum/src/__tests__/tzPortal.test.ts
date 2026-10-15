import type { GranumProviderPluginOptions } from '../build/plugin'
import type { GranumConfig } from '../config'
import type { GranumLoadedManifest, GranumProvider } from '../contract'
import type { PreparedApp } from '../node/prepare'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { granumProvider } from '../build/plugin'
import { defineGranumConfig } from '../config'
import { defineGranumComponent, defineGranumProvider } from '../contract'
import { emitCss } from '../node/emit'
import { buildReport } from '../node/report'
import { getThemeManifest } from '../node/themeManifest'
import { createThemeController } from '../runtime/controller'
import { granum } from '../vite/plugin'
import { validateGranumConfig } from '../vite/validateConfig'
import { fileThemeProvider, prepareTestApp, TEST_ENGINE } from './helpers'
import { TEST_DIALECT, testEngine } from './testEngine'

/**
 * Пункты ТЗ портала Granularity (`docs/tz-portal-2026-10/README.md`),
 * подтверждённые на текущем коде.
 *
 * Тесты фиксируют НЫНЕШНЕЕ поведение, которое ТЗ называет дефектом. Починка
 * пункта роняет его тест — тогда тест превращается в обычный (ожидание по
 * критерию готовности ТЗ), а пункт уходит из ТЗ и из roadmap.
 */

describe('пункт ТЗ-2: тема приложения поверх темы-файла', () => {
  const ocean = { names: ['light', 'dark', 'ocean'], define: { ocean: { extends: 'dark', selector: '[data-theme="ocean"]', tokens: { 'p-primary': '#4fd1e0' } } } }

  it('2.1: `theme-extends-unresolved` пропадает, когда компонент селекции добавил базе структурный блок', async () => {
    const { root, provider } = fileThemeProvider()
    const bare = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: ocean }, root)
    expect(bare.resolution.warnings).toContainEqual(expect.objectContaining({ kind: 'theme-extends-unresolved', theme: 'ocean' }))
    const tinted = await prepareTestApp({ providers: [provider], components: ['@p/ds:Tinted'], themes: ocean }, root)
    expect(tinted.resolution.warnings).toEqual([])
  })
})

describe('пункт ТЗ-5: манифест тем для темы-файла', () => {
  const activations = (app: PreparedApp): Record<string, unknown> =>
    Object.fromEntries(getThemeManifest(app.resolution).themes.map(t => [t.name, t.activation]))

  it('5.1: активация темы-файла зависит от селекции', async () => {
    const { root, provider } = fileThemeProvider()
    const themes = { names: ['light', 'dark'] }
    const plain = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes }, root)
    expect(activations(plain)).toEqual({ light: { type: 'unknown' }, dark: { type: 'unknown' } })
    const tinted = await prepareTestApp({ providers: [provider], components: ['@p/ds:Tinted'], themes }, root)
    expect(activations(tinted).dark).toEqual({ type: 'attribute', name: 'data-theme', value: 'dark' })
  })

  it('5.3: пример `activations` из troubleshooting (`kind`) не проходит типы', () => {
    // Форма из docs/{ru,en}/troubleshooting.md; тип активации — `{ type, value }`.
    const plugin = granum({ engine: TEST_ENGINE, providers: ['@p/ds'] }, {
      themeManifest: {
        activations: {
          // @ts-expect-error `kind` вместо `type` — так написано в доке
          dark: { kind: 'class', value: 'dark' },
        },
      },
    })
    expect(plugin.name).toBe('granum:app')
  })
})

describe('пункт ТЗ-10: мелкие расхождения', () => {
  it('10.3: ошибка контроллера тем объясняет `unknown` словами пресета v1', async () => {
    const { root, provider } = fileThemeProvider()
    const app = await prepareTestApp({ providers: [provider], components: ['@p/ds:Plain'], themes: { names: ['light', 'dark'] } }, root)
    expect(() => createThemeController(getThemeManifest(app.resolution), { storage: null }))
      .toThrow(/the preset inlines it/)
  })
})

describe('пункт ТЗ-6: неизвестные ключи конфига', () => {
  it('6: опечатка и ключи v1 проходят рантайм-проверку', () => {
    const config = { engine: TEST_ENGINE, providers: ['@p/ds'], appSource: { dirs: ['src'] }, themes: { themeFiles: { dark: './dark.css' } }, pruneTokens: { appSources: ['src'] } }
    expect(() => validateGranumConfig(config)).not.toThrow()
  })

  it('6: опечатка проходит и проверку типов `defineGranumConfig`', () => {
    // Компилируется: обобщённый параметр отключает проверку лишних свойств.
    // Починка типа сделает эту строку ошибкой компиляции — и `yarn typecheck` это покажет.
    const config = defineGranumConfig({ engine: TEST_ENGINE, providers: ['@p/ds'], appSource: { dirs: ['src'] } })
    expect(config.appSource).toEqual({ dirs: ['src'] })
  })
})

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

/** Пакет `@t/<name>` с компонентами `Card` и `Table`, баррелем в корне и подпутями. */
async function barrelPackage(name: string, extra: Record<string, string> = {}): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), `granum-tz-${name}-`))
  put(root, 'package.json', JSON.stringify({
    name: `@t/${name}`,
    version: '1.0.0',
    type: 'module',
    exports: { '.': './dist/index.js', './granum.manifest.json': './dist/granum.manifest.json', './components/Card': './dist/components/Card/index.js', './components/Table': './dist/components/Table/index.js' },
  }))
  put(root, 'src/components/Card/Card.vue', `<template><div class="t-card p-4"><slot /></div></template>\n`)
  put(root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\n`)
  put(root, 'src/components/Table/Table.vue', `<template><table class="t-table w-full"></table></template>\n`)
  put(root, 'src/components/Table/index.ts', `export { default as Table } from './Table.vue'\n`)
  put(root, 'src/index.ts', `export * from './components/Card/index.ts'\nexport * from './components/Table/index.ts'\n`)
  for (const [rel, content] of Object.entries(extra))
    put(root, rel, content)
  const url = (n: string): string => pathToFileURL(join(root, `src/components/${n}/config.ts`)).href
  await buildPackage(root, defineGranumProvider({
    id: `@t/${name}`,
    contractVersion: 1,
    components: [defineGranumComponent(url('Card'), { name: 'Card' }), defineGranumComponent(url('Table'), { name: 'Table' })],
  }))
  return root
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

describe('пункт ТЗ-3: контракт в рантайме провайдера', () => {
  /**
   * Провайдер реэкспортирует дескриптор из entry компонента, как эталонная
   * фикстура heavy и ядро granularity. Импорт контракта остаётся в dist, а
   * `package.json` пакета granum не объявляет — и сборка об этом молчит.
   */
  it('3: чанк компонента импортирует `@feugene/granum/contract`, а сборка не предупреждает', async () => {
    const root = await barrelPackage('cfg', {
      'src/components/Card/index.ts': `export { default as Card } from './Card.vue'\nexport { cardConfig } from './config.ts'\n`,
      'src/components/Card/config.ts': `import { defineGranumComponent } from '@feugene/granum/contract'\nexport const cardConfig = defineGranumComponent(import.meta.url, { name: 'Card' })\n`,
    })
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
    const cardJs = walk(join(root, 'dist/components/Card')).filter(f => f.endsWith('.js')).map(f => readFileSync(f, 'utf8')).join('\n')
    expect(cardJs).toContain('from "@feugene/granum/contract"')
    const manifest = JSON.parse(readFileSync(join(root, 'dist/granum.manifest.json'), 'utf8'))
    expect(manifest.warnings).toEqual([])
  })
})

describe('пункт ТЗ-4: импорт из корня провайдера', () => {
  it('4: guard не видит компонент вне селекции, импортированный из корня пакета', async () => {
    const pkg = await barrelPackage('bar')
    const app = await buildApp({ bar: pkg }, { providers: ['@t/bar'], components: ['@t/bar:Card'] }, `<script setup lang="ts">import { Card, Table } from '@t/bar'</script>\n<template><Card/><Table/></template>\n`)
    expect(app.report.selection.map((s: { key: string }) => s.key)).toEqual(['@t/bar:Card'])
    // Код Table в бандле, а его CSS-классов нет: компонент без утилит.
    expect(app.css).not.toContain('.w-full')
    // Тот же импорт подпутём guard ловит — разница только в спецификаторе.
    await expect(buildApp({ bar: pkg }, { providers: ['@t/bar'], components: ['@t/bar:Card'] }, `<script setup lang="ts">import { Table } from '@t/bar/components/Table'</script>\n<template><Table/></template>\n`))
      .rejects
      .toThrow(/Component '@t\/bar:Table' is imported from 'src\/App\.vue[^']*' but is not part of the granum selection/)
  })

  it('4: `components: \'imports\'` не считает импорт из корня, если тег не совпал с именем', async () => {
    const pkg = await barrelPackage('imp')
    const app = await buildApp({ imp: pkg }, { providers: ['@t/imp'], components: 'imports' }, `<script setup lang="ts">import { Table as Grid } from '@t/imp'</script>\n<template><Grid/></template>\n`)
    expect(app.report.selection).toEqual([])
  })
})

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
