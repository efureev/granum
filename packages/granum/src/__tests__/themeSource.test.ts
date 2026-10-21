import type { ThemeSourceReason } from '../core/errors'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeSourceError } from '../core/errors'
import { loadThemeSource } from '../node/themeSource'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** Исходник темы на диске: путь → содержимое; объект — JSON. */
function source(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'granum-theme-source-'))
  dirs.push(root)
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return root
}

const THEME_JSON = {
  $comment: 'пояснение автора',
  id: 'stone',
  title: 'Камень',
  version: '1.0.0',
  targets: { '@acme/ui': '^1.0.0', 'plain-ds': '^2.0.0' },
  defaultMode: 'light',
  modes: { light: { colorScheme: 'light', $why: 'светлый — основной' }, dark: { colorScheme: 'dark', title: 'Тёмный' } },
  extensions: { acme: { density: 'compact' } },
}

const FULL = {
  'theme.json': THEME_JSON,
  'root.json': { '$comment': 'основы', 'gr-radius': '6px' },
  'base.css': '@font-face { font-family: X; src: url(x.woff2) }',
  'modes/light.json': { 'gr-bg': '#ffffff' },
  'modes/dark.css': ':root { --gr-bg: #000000; }',
  'components/@acme/ui/Button/root.json': { 'btn-radius': '6px' },
  'components/@acme/ui/Button/modes/light.json': { 'btn-bg': '#ffffff' },
  'components/@acme/ui/Button/modes/dark.json': { 'btn-bg': '#111111' },
  'components/plain-ds/Card/modes/light.css': '.x { --card-bg: #fafafa; }',
  'README.md': '# Камень',
  'CHANGES.MD': '# 1.0.0',
  'components/@acme/ui/Button/NOTES.md': 'почему так',
  '.DS_Store': 'x',
  'notes.json': { why: 'потому' },
  'sources/palette.txt': 'raw',
}

function reasonOf(dir: string, options?: Parameters<typeof loadThemeSource>[1]): ThemeSourceReason | undefined {
  try {
    loadThemeSource(dir, options)
  }
  catch (error) {
    if (error instanceof ThemeSourceError)
      return error.reason
    throw error
  }
  return undefined
}

describe('исходник темы (C-42, INV-THEME-15)', () => {
  it('раскладка целиком: метаданные, корень, база, режимы, значения компонентов по пакетам', () => {
    const dir = source(FULL)
    const { sources: _sources, ...theme } = loadThemeSource(dir, { ignore: ['notes.json', 'sources'] })
    // Точное равенство: ключ с `$` — пояснение, он не становится ни токеном, ни полем.
    expect(theme).toEqual({
      id: 'stone',
      title: 'Камень',
      version: '1.0.0',
      targets: { '@acme/ui': '^1.0.0', 'plain-ds': '^2.0.0' },
      defaultMode: 'light',
      extensions: { acme: { density: 'compact' } },
      root: { 'gr-radius': '6px' },
      baseCss: ['@font-face { font-family: X; src: url(x.woff2) }'],
      modes: {
        light: { colorScheme: 'light', tokens: { 'gr-bg': '#ffffff' } },
        dark: { colorScheme: 'dark', title: 'Тёмный', tokens: { 'gr-bg': '#000000' } },
      },
      components: {
        '@acme/ui': { Button: { root: { 'btn-radius': '6px' }, modes: { light: { 'btn-bg': '#ffffff' }, dark: { 'btn-bg': '#111111' } } } },
        'plain-ds': { Card: { modes: { light: { 'card-bg': '#fafafa' } } } },
      },
    })
    expect(Object.keys(theme.modes ?? {})).toEqual(['light', 'dark'])
    // sources — для перезагрузки конфига в dev (A-33): все прочитанные файлы, и только они.
    expect(loadThemeSource(dir, { ignore: ['notes.json', 'sources'] }).sources!.map(file => file.slice(dir.length + 1))).toEqual([
      'base.css',
      'components/@acme/ui/Button/modes/dark.json',
      'components/@acme/ui/Button/modes/light.json',
      'components/@acme/ui/Button/root.json',
      'components/plain-ds/Card/modes/light.css',
      'modes/dark.css',
      'modes/light.json',
      'root.json',
      'theme.json',
    ])
  })

  it('принимает и URL папки', () => {
    expect(loadThemeSource(pathToFileURL(`${source(FULL)}/`), { ignore: ['notes.json', 'sources'] }).id).toBe('stone')
  })

  it('исходник с extends — только отличия; режим без своих полей объявляется пустой записью', () => {
    const dir = source({
      'theme.json': { id: 'ember', title: 'Угли', extends: 'stone', modes: { dark: {} } },
      'modes/dark.json': { 'gr-bg': '#1a0f0a' },
    })
    expect(loadThemeSource(dir)).toMatchObject({ id: 'ember', extends: 'stone', root: {}, modes: { dark: { tokens: { 'gr-bg': '#1a0f0a' } } } })
  })

  it('ни один файл не пропускается молча: каждая причина ThemeSourceError', () => {
    const cases: [ThemeSourceReason, Record<string, unknown>][] = [
      ['theme-json-missing', { 'root.json': {} }],
      ['theme-json-invalid', { 'theme.json': '{ not json' }],
      ['theme-json-invalid', { 'theme.json': { ...THEME_JSON, palette: {} } }],
      ['theme-json-invalid', { 'theme.json': { ...THEME_JSON, modes: { light: { colorScheme: 'light', tokens: {} } } } }],
      ['theme-json-invalid', { 'theme.json': { ...THEME_JSON, modes: [] } }],
      ['token-file-invalid', { 'theme.json': THEME_JSON, 'root.json': { '--gr-radius': '6px' } }],
      ['token-file-invalid', { 'theme.json': THEME_JSON, 'root.json': { 'gr-radius': 6 } }],
      ['token-file-invalid', { 'theme.json': THEME_JSON, 'modes/light.css': ':root { --a: 1 } .x { --b: 2 }' }],
      ['duplicate-value-file', { 'theme.json': THEME_JSON, 'root.json': {}, 'root.css': ':root {}' }],
      ['unknown-mode-file', { 'theme.json': THEME_JSON, 'modes/dim.json': {} }],
      ['unknown-mode-file', { 'theme.json': THEME_JSON, 'components/@acme/ui/Button/modes/dim.json': {} }],
      ['empty-component-dir', { 'theme.json': THEME_JSON, 'components/@acme/ui/Button/NOTES.md': 'x' }],
      ['unexpected-entry', { 'theme.json': THEME_JSON, 'notes.json': {} }],
      ['unexpected-entry', { 'theme.json': THEME_JSON, 'modes/light.txt': 'x' }],
      ['unexpected-entry', { 'theme.json': THEME_JSON, 'components/@acme/ui/Button/tokens.json': {} }],
      ['unexpected-entry', { 'theme.json': THEME_JSON, 'components/stray.json': {} }],
      ['theme-data-invalid', { 'theme.json': { ...THEME_JSON, version: 'next' } }],
      ['theme-data-invalid', { 'theme.json': THEME_JSON, 'components/Plain DS/Card/root.json': { 'card-pad': '1px' } }],
      ['theme-data-invalid', { 'theme.json': THEME_JSON, 'components/plain-ds/Card.v2/root.json': { 'card-pad': '1px' } }],
      ['theme-json-invalid', { 'theme.json/x': {} }],
      ['token-file-invalid', { 'theme.json': THEME_JSON, 'root.json/x': {} }],
      ['token-file-invalid', { 'theme.json': THEME_JSON, 'modes/light.css/x': {} }],
      ['unexpected-entry', { 'theme.json': THEME_JSON, 'modes': 'не папка' }],
      ['unexpected-entry', { 'theme.json': THEME_JSON, 'components': 'не папка' }],
      ['unexpected-entry', { 'theme.json': THEME_JSON, 'base.css/x': {} }],
      ['theme-data-invalid', { 'theme.json': { ...THEME_JSON, targets: {} }, 'components/@acme/ui/Button/root.json': { 'btn-radius': '6px' } }],
    ]
    for (const [reason, files] of cases)
      expect(reasonOf(source(files)), JSON.stringify(Object.keys(files))).toBe(reason)
  })

  it('ignore исключает файл или папку целиком, а не всё подряд', () => {
    expect(reasonOf(source(FULL))).toBe('unexpected-entry')
    expect(reasonOf(source(FULL), { ignore: ['notes.json'] })).toBe('unexpected-entry')
    expect(reasonOf(source(FULL), { ignore: ['./notes.json', 'sources/'] })).toBeUndefined()
  })

  it('нарушение данных называет свою причину в dataReason', () => {
    let error: unknown
    try {
      loadThemeSource(source({ 'theme.json': { ...THEME_JSON, targets: {} }, 'components/@acme/ui/Button/root.json': { 'btn-radius': '6px' } }))
    }
    catch (cause) {
      error = cause
    }
    expect(error).toMatchObject({ reason: 'theme-data-invalid', dataReason: 'theme-components-untargeted' })
    // Имя папки раздела — путь в исходнике и копии: оно проверяется формой, а не только на непустоту.
    expect(() => loadThemeSource(source({ 'theme.json': THEME_JSON, 'components/plain-ds/Card.v2/root.json': { 'card-pad': '1px' } }))).toThrow(/not a component name/)
    expect(() => loadThemeSource(source({ 'theme.json': THEME_JSON, 'components/Plain DS/Card/root.json': { 'card-pad': '1px' } }))).toThrow(/not a package name/)
  })

  it('ошибка называет файл', () => {
    const dir = source({ 'theme.json': THEME_JSON, 'modes/dim.json': {} })
    expect(() => loadThemeSource(dir)).toThrow(join(dir, 'modes', 'dim.json'))
  })
})
