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
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const cssOf = dir => readdirSync(join(dir, 'assets'))
  .filter(file => file.endsWith('.css'))
  .map(file => readFileSync(join(dir, 'assets', file), 'utf8'))
  .join('')

const reportOf = dir => JSON.parse(readFileSync(join(dir, 'granum-report.json'), 'utf8'))

const quiet = { logLevel: 'silent', customLogger: undefined }

// ── ТЗ-1. Подпуть части проходит мимо guard ──────────────────────────────────
{
  const root = join(here, 'cases/guard')
  const main = join(root, 'src/main.ts')
  const attempt = async (subpath, names, components = [{ provider: PROVIDER, names }]) => {
    writeFileSync(main, `import 'virtual:granum.css'\nimport * as part from '${PROVIDER}/components/${subpath}'\nconsole.log(part)\n`)
    try {
      await build({
        root,
        ...quiet,
        plugins: [granum({
          engine: windEngine(),
          providers: [PROVIDER],
          components,
          appSources: { dirs: ['src'] },
        })],
      })
      const css = cssOf(join(root, 'dist'))
      const selection = reportOf(join(root, 'dist')).selection.map(entry => entry.key.split(':')[1])
      return { passed: true, parentCss: css.includes('.xc-list') && /\.divide-y\b/.test(css), selection }
    }
    catch (error) {
      return { passed: false, error: (error.message.split('\n').find(line => /Error/.test(line)) ?? error.message).trim() }
    }
  }
  try {
    const part = await attempt('XcListItem', ['XcButton'])
    const parent = await attempt('XcList', ['XcButton'])
    const control = await attempt('XcListItem', ['XcButton', 'XcList'])
    const fromImports = await attempt('XcListItem', [], 'imports')
    const now = part.passed
      ? `components/XcListItem при селекции [XcButton]: сборка прошла, CSS XcList ${part.parentCss ? 'есть' : 'нет'}`
      : `components/XcListItem: ${part.error}`
    record(
      'ТЗ-1',
      'подпуть части проходит мимо guard',
      `${now}; components/XcList — ${parent.passed ? 'прошла' : 'ComponentOutsideSelectionError'}; с XcList в селекции CSS ${control.parentCss ? 'есть' : 'нет'}`,
      'components/XcListItem при селекции без XcList — ComponentOutsideSelectionError на XcList, как у components/XcList',
      part.passed,
    )
    record(
      'ТЗ-1б',
      'селекция из импортов не видит части',
      `components: 'imports', импорт components/XcListItem: селекция ${JSON.stringify(fromImports.selection)}, CSS XcList ${fromImports.parentCss ? 'есть' : 'нет'}`,
      `селекция [XcList] и его CSS — как при импорте components/XcList`,
      !fromImports.selection?.includes('XcList'),
    )
  }
  finally {
    writeFileSync(main, `import 'virtual:granum.css'\n`)
  }
}

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
