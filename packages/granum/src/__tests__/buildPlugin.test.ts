import type { GranumManifest, GranumProvider } from '../contract'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { granumProvider } from '../build/plugin'
import { defineGranumComponent, defineGranumProvider } from '../contract'
import { BoundaryViolationError, CssReadError, EngineDialectMismatchError, PackageExportsError, UndeclaredDependencyError } from '../core/errors'
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
} = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'granum-build-'))
  const { declareDependency = true, exportsOk = true, nodeImport = false, brokenCss = false, engineRules = false, plain = false } = options

  write(root, 'package.json', JSON.stringify({
    name: '@t/kit',
    version: '1.2.3',
    type: 'module',
    exports: exportsOk
      ? { '.': './dist/index.js', './granum.manifest.json': './dist/granum.manifest.json', './components/Card': './dist/components/Card/index.js', './components/Panel': './dist/components/Panel/index.js' }
      : { '.': './dist/index.js' },
  }))
  write(root, 'src/index.ts', `export * from './components/Card/index.ts'\nexport * from './components/Panel/index.ts'\n`)
  write(root, 'src/theme/tokens.css', ':root{--t-space:8px;--t-bg:#fff}\n@supports (x:1){:root{--t-fallback:1}}')
  write(root, 'src/theme/dark.css', '.dark{--t-bg:#000}')
  write(root, 'src/components/Card/Card.vue', plain
    ? `<script setup lang="ts"></script>\n<template><div class="t-card"><slot /></div></template>\n<style>.t-card{gap:var(--t-space);}</style>\n`
    : `<script setup lang="ts">${nodeImport ? `import { readFileSync } from 'node:fs'; void readFileSync` : ''}</script>\n<template><div class="t-card p-4 bg-[var(--t-bg)]"><slot /></div></template>\n<style>.t-card{gap:var(--t-space);@apply font-bold;}</style>\n`)
  write(root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\n`)
  write(root, 'src/components/Panel/Panel.vue', plain
    ? `<script setup lang="ts">\nimport { Card } from '../Card/index.ts'\n</script>\n<template><section class="t-panel"><Card /></section></template>\n`
    : `<script setup lang="ts">\nimport { Card } from '../Card/index.ts'\nconst z = '--t-z'\n</script>\n<template><section class="flex gap-2" :style="{ zIndex: 'var(' + z + ')' }"><Card /><!-- p-9 --></section></template>\n`)
  write(root, 'src/components/Panel/index.ts', `export { default as Panel } from './Panel.vue'\n`)
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
    theme: { tokensCss: 'theme/tokens.css', themes: { dark: 'theme/dark.css' }, defaultThemes: ['light'] },
    ...(engineRules ? { engine: { dialect: TEST_DIALECT, rules: [['kit-reset', { appearance: 'none' }] as const] } } : {}),
  })
  return { root, provider }
}

async function run(fixture: Fixture, pluginOptions: Partial<Parameters<typeof granumProvider>[0]> = {}): Promise<{ manifest: GranumManifest, dist: string, logs: string[] }> {
  const logs: string[] = []
  await build({
    root: fixture.root,
    configFile: false,
    logLevel: 'silent',
    plugins: [vue(), granumProvider({ provider: fixture.provider, engine: testEngine(), log: l => logs.push(l), ...pluginOptions })],
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
})
