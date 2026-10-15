import type { RolldownWatcher } from 'rolldown'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { granum } from '../vite/plugin'
import { makeManifest } from './helpers'
import { testEngine } from './testEngine'

/**
 * `vite build --watch` на сборке приложения.
 *
 * Состояние плагина живёт между пересборками: резолюция, эмиссия и флаг
 * «отчёт уже написан» мемоизированы. Сбрасывать их на каждый `buildStart`
 * нельзя — многосредовый хост зовёт его на каждое окружение одной сборки, — и
 * сброс идёт по `watchChange`: файл изменился, значит это новая сборка.
 *
 * Сессия настоящая, как в `buildWatch.test.ts`: ждём факт на диске, а не событие.
 */

const TIMEOUT = 45_000
const WAIT = 15_000

function write(root: string, rel: string, content: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}

function app(root: string, classes: string): void {
  write(root, 'src/App.vue', `<template><div class="${classes}"/></template>\n`)
}

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + WAIT
  while (Date.now() < deadline) {
    try {
      const value = read()
      if (value !== undefined)
        return value
    }
    catch {}
    await new Promise<void>(resolve => void setTimeout(resolve, 25))
  }
  throw new Error(`не дождались: ${what}`)
}

describe('vite build --watch на сборке приложения', () => {
  it('пересборка отдаёт CSS и отчёт по новым исходникам', { timeout: TIMEOUT }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'granum-app-watch-'))
    const providerDir = join(root, 'provider')
    mkdirSync(providerDir, { recursive: true })
    const provider = { ...makeManifest('@t/kit'), baseUrl: `${pathToFileURL(providerDir).href}/` }

    mkdirSync(join(root, 'node_modules'), { recursive: true })
    if (!existsSync(join(root, 'node_modules/vue')))
      symlinkSync(join(process.cwd(), '../../node_modules/vue'), join(root, 'node_modules/vue'), 'dir')
    write(root, 'index.html', `<!doctype html><div id="app"></div><script type="module" src="/src/main.ts"></script>`)
    write(root, 'src/main.ts', `import 'virtual:granum.css'\nimport { createApp } from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#app')\n`)
    app(root, 'p-3')

    const watcher = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [vue(), granum({ providers: [provider], engine: testEngine(), appSources: { dirs: ['src'] } }, { log: () => {} })],
      build: { minify: false, watch: {} },
    }) as RolldownWatcher

    const css = (): string => {
      const assets = join(root, 'dist/assets')
      return readdirSync(assets).filter(f => f.endsWith('.css')).map(f => readFileSync(join(assets, f), 'utf8')).join('\n')
    }
    const report = (): { classes: { matched: number } } => JSON.parse(readFileSync(join(root, 'dist/granum-report.json'), 'utf8'))

    try {
      await until(() => (css().includes('.p-3{') ? true : undefined), 'первая сборка с .p-3')
      expect((await until(() => report(), 'отчёт первой сборки')).classes.matched).toBe(1)

      // Два класса вместо одного: по числу совпавших отчёт пересборки
      // отличается от оставшегося с первой сборки.
      app(root, 'p-9 p-10')
      await until(() => (css().includes('.p-9{') ? true : undefined), 'пересборка с .p-9 в CSS')
      await until(() => (report().classes.matched === 2 ? true : undefined), 'отчёт пересборки')

      expect(css()).not.toContain('.p-3{')
    }
    finally {
      await watcher.close()
    }
  })
})
