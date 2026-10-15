import type { GranumLoadedManifest } from '../contract'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emitCss } from '../node/emit'
import { buildReport } from '../node/report'
import { fileThemeProvider, prepareTestApp } from './helpers'

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
