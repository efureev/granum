#!/usr/bin/env node
/**
 * Воспроизведение ТЗ granularity от 2026-10-15 (`docs/tz-granularity-2026-10-15`)
 * на фикстурах granum, без пакетов granularity.
 *
 *   yarn build && yarn workspace @granum-fixtures/composite build
 *   yarn workspace @granum-apps/tz-granularity repro          # что сейчас и что ждём
 *   yarn workspace @granum-apps/tz-granularity repro:expect   # код 1, пока хоть одно воспроизводится
 *
 * У стенда нет `build` и `verify`, поэтому `build:apps` и `verify:apps` его
 * пропускают. Когда все пункты закрыты, `repro:expect` становится его `verify`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { windEngine } from '@feugene/granum-engine-wind'
import { granum, granumResolver } from '@feugene/granum/vite'
import { build } from 'vite'

const here = fileURLToPath(new URL('./', import.meta.url))
const PROVIDER = '@granum-fixtures/composite'
const results = []

const record = (id, title, now, expected, reproduced) => results.push({ id, title, now, expected, reproduced })

const reportOf = dir => JSON.parse(readFileSync(join(dir, 'granum-report.json'), 'utf8'))

const quiet = { logLevel: 'silent', customLogger: undefined }

// ── ТЗ-2. granumResolver не знает частей ─────────────────────────────────────
{
  const resolver = granumResolver({ providers: [PROVIDER] }, { root: here })
  const got = Object.fromEntries(['XcList', 'XcListItem'].map(name => [name, resolver.resolve(name)?.from]))
  record(
    'ТЗ-2',
    'granumResolver не резолвит части',
    `XcList → ${got.XcList}; XcListItem → ${got.XcListItem}`,
    `XcListItem → ${PROVIDER}/components/XcListItem (подпуть, который guard сводит к XcList)`,
    got.XcListItem === undefined,
  )
}

// ── ТЗ-5. CSS приложения, подключённый строкой (`?raw`), отчёту не виден ─────
{
  const root = join(here, 'cases/raw-css')
  await build({
    root,
    ...quiet,
    plugins: [granum({
      engine: windEngine(),
      providers: [PROVIDER],
      components: [],
      appSources: { dirs: ['src', '.'], extensions: ['ts', 'html', 'css'] },
    })],
  })
  const unmatched = reportOf(join(root, 'dist')).classes.unmatched.map(entry => entry.className)
  record(
    'ТЗ-5',
    'CSS приложения через ?raw не виден проверке unmatched',
    `unmatched: ${JSON.stringify(unmatched)} — правило .raw-note в src/raw.css, на страницу едет строкой`,
    'класс с правилом в .css из appSources не в unmatched (или ограничение и способ его снять — в документации)',
    unmatched.includes('raw-note'),
  )
}

// ── Итог ─────────────────────────────────────────────────────────────────────
for (const r of results) {
  console.log(`\n${r.reproduced ? '✗ воспроизводится' : '✓ исправлено'}  ${r.id}: ${r.title}`)
  console.log(`  сейчас: ${r.now}`)
  console.log(`  ждём:   ${r.expected}`)
}
const open = results.filter(r => r.reproduced).length
console.log(`\n${open} из ${results.length} воспроизводятся.`)
if (process.argv.includes('--expect') && open > 0)
  process.exit(1)
