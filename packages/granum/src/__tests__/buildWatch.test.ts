import type { RolldownWatcher } from 'rolldown'
import type { GranumManifest, GranumProvider } from '../contract'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { granumProvider } from '../build/plugin'
import { defineGranumComponent, defineGranumProvider } from '../contract'
import { readManifestSync } from '../node/manifest'
import { testEngine } from './testEngine'

/**
 * `vite build --watch` на сборке провайдера (B-15).
 *
 * Отдельный файл от `buildPlugin.test.ts`, потому что проверяется то, чего два
 * последовательных `build()` не воспроизводят: в watch-сессии `configResolved`
 * срабатывает один раз, `transform` при пересборке идёт только по изменённым
 * модулям, а состояние плагина живёт между сборками. Именно поэтому сброс
 * сделан в `buildStart`, и именно поэтому раньше он был проверен только руками.
 *
 * Сессия здесь настоящая: `build()` с `build.watch` возвращает watcher, правка
 * файла на диске вызывает пересборку, а утверждения читают то, что плагин
 * записал на диск.
 */

const TIMEOUT = 30_000

function write(root: string, rel: string, content: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}

/** Провайдер из одного компонента: для watch важна пересборка, а не состав. */
function makeFixture(): { root: string, provider: GranumProvider } {
  const root = mkdtempSync(join(tmpdir(), 'granum-watch-'))
  write(root, 'package.json', JSON.stringify({
    name: '@t/watch',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './dist/index.js', './granum.manifest.json': './dist/granum.manifest.json', './components/Card': './dist/components/Card/index.js' },
  }))
  write(root, 'src/index.ts', `export * from './components/Card/index.ts'\n`)
  write(root, 'src/theme/tokens.css', ':root{--t-space:8px}\n')
  write(root, 'src/components/Card/index.ts', `export { default as Card } from './Card.vue'\n`)
  card(root, 'p-4')

  const provider = defineGranumProvider({
    id: '@t/watch',
    contractVersion: 1,
    components: [defineGranumComponent(pathToFileURL(join(root, 'src/components/Card/config.ts')).href, { name: 'Card' })],
    theme: { tokensCss: 'theme/tokens.css', themes: {}, defaultThemes: ['light'] },
  })
  return { root, provider }
}

/** Компонент с одной утилитой в разметке; `nodeImport` пробивает границу browser/node. */
function card(root: string, utility: string, options: { nodeImport?: boolean } = {}): void {
  const script = options.nodeImport ? `import { readFileSync } from 'node:fs'; void readFileSync` : ''
  write(
    root,
    'src/components/Card/Card.vue',
    `<script setup lang="ts">${script}</script>\n<template><div class="t-card ${utility}"><slot /></div></template>\n<style>.t-card{gap:var(--t-space);}</style>\n`,
  )
}

interface Session {
  /** Ждёт, пока манифест на диске станет удовлетворять условию. */
  await: (predicate: (manifest: GranumManifest) => boolean, what: string) => Promise<GranumManifest>
  close: () => Promise<void>
}

/**
 * Watch-сессия.
 *
 * Ждём не событие сборки, а ФАКТ на диске. События `END` приходят и на первую
 * сборку, и на пересборки, и порядок их доставки зависит от нагрузки: тест,
 * считавший события, зеленел в одиночку и падал раз в три прогона в общем
 * наборе, читая манифест от предыдущей сборки. Опрос файла от такой гонки
 * свободен, а предмет проверки — ровно содержимое манифеста.
 */
async function watch(root: string, provider: GranumProvider, logs: string[], boundaryCheck: 'error' | 'warn' = 'error'): Promise<Session> {
  const watcher = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [vue(), granumProvider({ provider, engine: testEngine(), boundaryCheck, log: l => logs.push(l) })],
    build: { minify: false, watch: {}, rolldownOptions: { external: ['vue'] } },
  }) as RolldownWatcher

  const manifestPath = join(root, 'dist/granum.manifest.json')
  return {
    await: async (predicate, what) => {
      const deadline = Date.now() + TIMEOUT
      while (Date.now() < deadline) {
        try {
          // Манифест могут писать прямо сейчас: недочитанный JSON — не отказ, а повод подождать.
          const { manifest } = readManifestSync(manifestPath)
          if (predicate(manifest))
            return manifest
        }
        catch {}
        await new Promise<void>(resolve => void setTimeout(resolve, 25))
      }
      throw new Error(`не дождались: ${what}`)
    },
    close: async () => void await watcher.close(),
  }
}

describe('vite build --watch на сборке провайдера (B-15)', () => {
  it('пересборка перезаписывает манифест', { timeout: TIMEOUT }, async () => {
    const { root, provider } = makeFixture()
    const logs: string[] = []
    const session = await watch(root, provider, logs)

    try {
      const first = await session.await(m => m.components.Card!.classes.includes('p-4'), 'первая сборка с классом p-4')

      // Правка разметки: класс меняется, значит манифест обязан измениться тоже.
      card(root, 'p-8')
      const second = await session.await(m => m.components.Card!.classes.includes('p-8'), 'пересборка с классом p-8')

      // Старый класс не остался: манифест перезаписан целиком, а не дополнен.
      expect(second.components.Card!.classes).not.toContain('p-4')
      expect(second.components.Card!.hash).not.toBe(first.components.Card!.hash)
    }
    finally {
      await session.close()
    }
  })

  it('нарушение границы из прошлой сборки не переживает починку', { timeout: TIMEOUT }, async () => {
    /*
     * Ради этого сброс и сделан в `buildStart`. В watch-сессии `transform`
     * второй сборки идёт только по изменённому модулю, и нарушение, собранное
     * в первой, продолжало бы ронять сборку после починки кода — навсегда, до
     * перезапуска. Два последовательных `build()` такого не показывают.
     */
    const { root, provider } = makeFixture()
    card(root, 'p-4', { nodeImport: true })
    const logs: string[] = []
    // `warn`, а не `error`: watch-сессия заворачивает исключение хука в своё
    // событие без текста, и утверждать по нему было бы не о чем. Предмет теста
    // не способ доклада, а то, доживает ли нарушение до следующей сборки.
    const session = await watch(root, provider, logs, 'warn')

    try {
      await session.await(m => m.components.Card!.classes.includes('p-4'), 'первая сборка')
      expect(logs.some(line => line.includes('node:fs'))).toBe(true)

      // Класс меняется вместе с починкой: по нему видно, что манифест уже от
      // второй сборки, и только тогда отсутствие нарушения что-то значит.
      logs.length = 0
      card(root, 'p-5')
      await session.await(m => m.components.Card!.classes.includes('p-5'), 'пересборка после починки')

      expect(logs.filter(line => line.includes('node:fs'))).toEqual([])
    }
    finally {
      await session.close()
    }
  })
})
