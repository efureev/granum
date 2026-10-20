import type { ModuleNode, ViteDevServer } from 'vite'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { build, createServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { granumProvider } from '../build/plugin'
import { defineGranumComponent, defineGranumProvider } from '../contract'
import { granum } from '../vite/plugin'
import { testEngine } from './testEngine'

/**
 * Dev-сервер на настоящем Vite: какие виртуальные модули перезагружаются
 * и какие файлы провайдера отслеживаются. HMR-сокет выключен — решение плагина
 * видно по вызовам `reloadModule`, браузер для этого не нужен (сквозной
 * сценарий в браузере — `scripts/e2e-dev.mjs`).
 */
function write(root: string, rel: string, content: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}

async function buildProvider(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'granum-dev-provider-'))
  write(root, 'package.json', JSON.stringify({
    name: '@t/kit',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './dist/index.js', './granum.manifest.json': './dist/granum.manifest.json', './components/Card': './dist/components/Card/index.js' },
  }))
  write(root, 'src/theme/tokens.css', ':root{--t-space:8px}')
  write(root, 'src/themes/kit.json', JSON.stringify({ id: 'kit', title: 'Kit', root: {}, modes: { light: { colorScheme: 'light', tokens: { 't-bg': '#fff' } }, dark: { colorScheme: 'dark', tokens: { 't-bg': '#000' } } } }))
  write(root, 'src/themes/ink.json', JSON.stringify({ id: 'ink', title: 'Ink', root: {}, modes: { light: { colorScheme: 'light', tokens: { 't-bg': '#eee' } }, dark: { colorScheme: 'dark', tokens: { 't-bg': '#111' } } } }))
  write(root, 'src/components/Card/Card.vue', `<template><div class="t-card p-4"><slot /></div></template>\n<style>.t-card{gap:var(--t-space)}</style>\n`)
  write(root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\n`)
  write(root, 'src/index.ts', `export * from './components/Card/index.ts'\n`)
  const provider = defineGranumProvider({
    id: '@t/kit',
    contractVersion: 2,
    components: [defineGranumComponent(pathToFileURL(join(root, 'src/components/Card/config.ts')).href, { name: 'Card' })],
    theme: { tokensCss: 'theme/tokens.css', defaultTheme: 'kit', catalog: { kit: { title: 'Kit', data: 'themes/kit.json' }, ink: { title: 'Ink', data: 'themes/ink.json' } } },
  })
  await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), granumProvider({ provider, engine: testEngine(), log: () => {} })], build: { minify: false, rolldownOptions: { external: ['vue'] } } })
  return root
}

const APP = `<script setup lang="ts">import { Card } from 'virtual:granum/components'</script>\n<template><Card/></template>\n`
const CSS_ID = '\0virtual:granum.css'
const THEMES_ID = '\0virtual:granum/themes'
const COMPONENTS_ID = '\0virtual:granum/components'

interface DevApp {
  readonly root: string
  readonly server: ViteDevServer
  readonly reloaded: string[]
}

let open: ViteDevServer | undefined

afterEach(async () => {
  await open?.close()
  open = undefined
})

async function startApp(providerRoot: string, extra: Partial<Parameters<typeof granum>[0]> = {}, pluginOptions: Omit<NonNullable<Parameters<typeof granum>[1]>, 'log'> = {}): Promise<DevApp> {
  const root = mkdtempSync(join(tmpdir(), 'granum-dev-app-'))
  mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
  symlinkSync(providerRoot, join(root, 'node_modules/@t/kit'), 'dir')
  symlinkSync(join(process.cwd(), '../../node_modules/vue'), join(root, 'node_modules/vue'), 'dir')
  write(root, 'src/App.vue', APP)

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    plugins: [vue(), granum({ providers: ['@t/kit'], engine: testEngine(), appSources: { dirs: ['src'] }, components: ['@t/kit:Card'], themes: [{ theme: 'kit', modes: ['light', 'dark'] }], ...extra }, { log: () => {}, ...pluginOptions })],
    server: { middlewareMode: true, hmr: false },
  })
  open = server
  // Шпион вместо HMR: записывает решение плагина и сбрасывает модуль в графе,
  // чтобы следующий запрос получил новый код.
  const reloaded: string[] = []
  server.reloadModule = async (mod: ModuleNode) => {
    reloaded.push(mod.id!)
    server.moduleGraph.invalidateModule(mod)
  }
  for (const id of ['virtual:granum.css', 'virtual:granum/themes', 'virtual:granum/components'])
    await server.transformRequest(id)
  return { root, server, reloaded }
}

async function waitFor(check: () => boolean, what: string, ms = 10_000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until)
      throw new Error(`timed out waiting for ${what}`)
    await new Promise(r => setTimeout(r, 50))
  }
}

/** Каталог под наблюдением watcher: только тогда правка в нём даст событие. */
function watching(server: ViteDevServer, dir: string): boolean {
  return Object.keys(server.watcher.getWatched()).includes(dir)
}

describe('granum() на dev-сервере', async () => {
  const providerRoot = await buildProvider()

  /**
   * Модуль тем — JS без границы HMR: его перезагрузка поднимается до входа, и
   * Vite перезагружает страницу. Правка разметки его содержимого не меняет.
   */
  it('правка разметки перезагружает CSS, но не модули тем и компонентов', async () => {
    const app = await startApp(providerRoot)
    await waitFor(() => watching(app.server, join(realpathSync(app.root), 'src')), 'watcher on src')

    writeFileSync(join(app.root, 'src/App.vue'), APP.replace('<Card/>', '<Card class="italic"/>'))
    await waitFor(() => app.reloaded.includes(CSS_ID), 'CSS reload')
    await new Promise(r => setTimeout(r, 300))

    expect(app.reloaded).not.toContain(THEMES_ID)
    expect(app.reloaded).not.toContain(COMPONENTS_ID)
    expect((await app.server.transformRequest('virtual:granum.css'))?.code).toContain('font-style:italic')
  }, 30_000)

  /**
   * Провайдер-воркспейс лежит вне корня приложения, а в `node_modules` —
   * симлинк, который watcher Vite игнорирует. Пересборка провайдера обязана
   * доехать до dev приложения: файлы провайдера отслеживаются явно.
   */
  it('новое значение токена в dist провайдера вне корня перезагружает CSS', async () => {
    const app = await startApp(providerRoot)
    const tokens = realpathSync(join(providerRoot, 'dist/theme/tokens.css'))
    await waitFor(() => watching(app.server, dirname(tokens)), 'watcher on the provider theme')

    writeFileSync(tokens, readFileSync(tokens, 'utf8').replace('8px', '9px'))
    await waitFor(() => app.reloaded.includes(CSS_ID), 'CSS reload')
    expect((await app.server.transformRequest('virtual:granum.css'))?.code).toContain('--t-space:9px')
  }, 30_000)

  /**
   * Тема-объект живёт в конфиге, а конфиг читается один раз на процесс Vite:
   * правку файлов, из которых он собран, подхватывает только перезапуск.
   */
  it('правка файла из sources темы-объекта перезапускает dev-сервер', async () => {
    const sourcesDir = realpathSync(mkdtempSync(join(tmpdir(), 'granum-theme-src-')))
    write(sourcesDir, 'theme.json', '{}')
    const theme = { id: 'own', title: 'Own', root: {}, modes: { light: { colorScheme: 'light' as const, tokens: { 't-bg': '#fff' } } }, sources: [sourcesDir] }
    const app = await startApp(providerRoot, { themes: [theme] })
    const restart = vi.spyOn(app.server, 'restart').mockResolvedValue()
    await waitFor(() => watching(app.server, sourcesDir), 'watcher on theme sources')
    writeFileSync(join(sourcesDir, 'theme.json'), '{"changed":true}')
    await waitFor(() => restart.mock.calls.length > 0, 'server restart')
    expect(restart).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('компонент из корня пакета — ошибка и в dev: Vite покажет её оверлеем', async () => {
    const app = await startApp(providerRoot)
    write(app.root, 'src/App.vue', `<script setup lang="ts">import { Card } from '@t/kit'</script>\n<template><Card/></template>\n`)
    await expect(app.server.transformRequest('/src/App.vue')).rejects.toMatchObject({ code: 'component-root-import', components: ['Card'] })
  })
})

describe('dev: лист дополнительной темы', () => {
  /** Ответ dev-сервера на запрос листа ссылкой `<link>`: статус, тип и тело. */
  async function get(server: ViteDevServer, url: string): Promise<{ status: number, type: string | undefined, body: string }> {
    return new Promise((done, fail) => {
      const headers = new Map<string, string>()
      const res = {
        statusCode: 200,
        setHeader: (name: string, value: string) => void headers.set(name.toLowerCase(), String(value)),
        getHeader: (name: string) => headers.get(name.toLowerCase()),
        removeHeader: (name: string) => void headers.delete(name.toLowerCase()),
        writeHead: (status: number) => { res.statusCode = status },
        end: (body?: string | Uint8Array) => done({ status: res.statusCode, type: headers.get('content-type'), body: body === undefined ? '' : String(body) }),
      }
      server.middlewares.handle({ url, method: 'GET', headers: { accept: 'text/css,*/*;q=0.1', host: 'localhost' } } as never, res as never, ((error: unknown) => (error ? fail(error) : done({ status: 404, type: undefined, body: '' }))) as never)
    })
  }

  it('адрес из манифеста — файл листа, который отдаёт сам dev-сервер; у основной темы адреса нет', async () => {
    const providerRoot = await buildProvider()
    const app = await startApp(providerRoot, { themes: [{ theme: 'kit', default: true, modes: ['light', 'dark'] }, { theme: 'ink', modes: ['light', 'dark'] }] }, { themeScript: true })
    const code = (await app.server.transformRequest('virtual:granum/themes'))!.code
    // Строкой, а не импортом `?url`: тот дал бы `/@fs/@granum-theme/…`, а скрипт до первого кадра — без `/@fs`.
    expect(code).toContain('"/@granum-theme/granum-theme-ink.css"')
    expect(code).not.toContain('?url')
    expect(code).not.toContain('granum-theme-kit')
    const html = await app.server.transformIndexHtml('/index.html', '<!doctype html><html><head></head><body></body></html>')
    expect(html).toContain('ink:"/@granum-theme/granum-theme-ink.css"')
    // В dev стили приходят из JS уже после ссылки скрипта: порядок слоёв
    // приложение объявляет в `<head>` само, и скрипт MUST стоять после него.
    const declared = await app.server.transformIndexHtml('/index.html', '<!doctype html><html><head><style>@layer reset, granum;</style></head><body></body></html>')
    expect(declared.indexOf('@layer reset, granum;')).toBeGreaterThan(-1)
    expect(declared.indexOf('@layer reset, granum;')).toBeLessThan(declared.indexOf('ink:"/@granum-theme/'))
    const sheet = await get(app.server, '/@granum-theme/granum-theme-ink.css')
    expect(sheet.type).toMatch(/text\/css/)
    expect(sheet.body).toMatch(/@layer granum\.themes \{[\s\S]*\[data-theme="ink-dark"\]/)
    expect(sheet.body).not.toContain('kit-')
  })
})

describe('dev: манифест тем', () => {
  it('модуль манифеста не ждёт движок: адресам листов он не нужен', async () => {
    const providerRoot = await buildProvider()
    const root = mkdtempSync(join(tmpdir(), 'granum-dev-manifest-'))
    mkdirSync(join(root, 'node_modules/@t'), { recursive: true })
    symlinkSync(providerRoot, join(root, 'node_modules/@t/kit'), 'dir')
    // Движок, который не отвечает никогда: всё, что его ждёт, зависнет.
    const engine = { ...testEngine(), generate: () => new Promise<never>(() => {}) }
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      plugins: [granum({ providers: ['@t/kit'], engine, appSources: { dirs: ['src'] }, components: ['@t/kit:Card'], themes: [{ theme: 'kit', default: true, modes: ['light', 'dark'] }, { theme: 'ink', modes: ['light', 'dark'] }] }, { log: () => {} })],
      server: { middlewareMode: true, hmr: false },
    })
    open = server
    const timeout = new Promise<'timeout'>(done => setTimeout(done, 3000, 'timeout'))
    const result = await Promise.race([server.transformRequest('virtual:granum/themes'), timeout])
    expect(result).not.toBe('timeout')
    expect((result as { code: string }).code).toContain('/@granum-theme/granum-theme-ink.css')
  })
})
