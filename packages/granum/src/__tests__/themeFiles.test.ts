import type { InvalidProviderError } from '../core/errors'
/**
 * Файлы тем на диске: папка `themesDir` компонента (C-33, C-34, C-13), данные
 * темы и реестр токенов.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InvalidTokenKeyError, TokenRefError } from '../core/errors'
import { readComponentThemesDir, readRegistry, readThemeDataFile } from '../node/themeFiles'

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'granum-theme-files-'))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  return root
}

function reasonOf(run: () => unknown): string | undefined {
  try {
    run()
  }
  catch (error) {
    return (error as InvalidProviderError).reason ?? (error as Error).name
  }
  return undefined
}

describe('themesDir', () => {
  it('root и режимы, JSON и CSS с одним плоским блоком; README и скрытые файлы — мимо', () => {
    const themes = readComponentThemesDir('@p', 'Button', dir({
      'paper/root.json': '{"b-gap":"8px"}',
      'paper/modes/light.json': '{"b-bg":"#fff"}',
      'paper/modes/dark.css': '.whatever { --b-bg: #000; --b-ring: url("a;b") }',
      'ink/modes/light.json': '{"b-bg":"#111"}',
      'README.md': '# токены кнопки',
      '.DS_Store': '',
    }))
    expect(themes).toEqual({
      ink: { modes: { light: { 'b-bg': '#111' } } },
      paper: { root: { 'b-gap': '8px' }, modes: { dark: { 'b-bg': '#000', 'b-ring': 'url("a;b")' }, light: { 'b-bg': '#fff' } } },
    })
  })

  it('имя папки — не id темы, файл режима — не имя режима, лишний файл — invalid-theme-dir', () => {
    expect(reasonOf(() => readComponentThemesDir('@p', 'B', dir({ 'Paper/modes/light.json': '{}' })))).toBe('invalid-theme-dir')
    expect(reasonOf(() => readComponentThemesDir('@p', 'B', dir({ 'paper/modes/dark-blue.json': '{}' })))).toBe('invalid-theme-dir')
    expect(reasonOf(() => readComponentThemesDir('@p', 'B', dir({ 'paper/modes/root.json': '{}' })))).toBe('invalid-theme-dir')
    expect(reasonOf(() => readComponentThemesDir('@p', 'B', dir({ 'paper/extra.json': '{}' })))).toBe('invalid-theme-dir')
    expect(reasonOf(() => readComponentThemesDir('@p', 'B', dir({ 'paper/modes/light.json': '{}', 'paper/modes/light.css': ':root{--a:1}' })))).toBe('invalid-theme-dir')
  })

  it('ключ с -- — InvalidTokenKeyError; CSS с двумя блоками — TokenParseError внутри TokenRefError', () => {
    expect(() => readComponentThemesDir('@p', 'B', dir({ 'paper/modes/light.json': '{"--b-bg":"#fff"}' }))).toThrow(InvalidTokenKeyError)
    let error: unknown
    try {
      readComponentThemesDir('@p', 'B', dir({ 'paper/modes/light.css': ':root{--a:1} .x{--b:2}' }))
    }
    catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(TokenRefError)
    expect((error as TokenRefError).cause).toMatchObject({ reason: 'unsupported-blocks' })
  })

  it('папки нет — invalid-theme-dir', () => {
    expect(reasonOf(() => readComponentThemesDir('@p', 'B', join(tmpdir(), 'granum-no-such-dir')))).toBe('invalid-theme-dir')
  })
})

describe('данные темы и реестр', () => {
  it('полные данные проверяются целиком; частичные — только форма', () => {
    const root = dir({
      'full.json': JSON.stringify({ id: 'paper', title: 'P', root: {}, modes: { dark: { colorScheme: 'dark', tokens: {} } } }),
      'patch.json': JSON.stringify({ modes: { dim: { extends: 'dark', tokens: { a: '1' } } } }),
    })
    expect(reasonOf(() => readThemeDataFile('@p', 'paper', join(root, 'full.json')))).toBe('default-mode-missing')
    expect(readThemeDataFile('@p', 'ink', join(root, 'patch.json'), { partial: true }).modes).toBeDefined()
  })

  it('реестр: root | mode, ключи без --', () => {
    const root = dir({ 'ok.json': '{"a":"root","b":"mode"}', 'bad.json': '{"a":"theme"}', 'dash.json': '{"--a":"root"}' })
    expect(readRegistry('@p', join(root, 'ok.json'))).toEqual({ a: 'root', b: 'mode' })
    expect(reasonOf(() => readRegistry('@p', join(root, 'bad.json')))).toBe('invalid-theme-data')
    expect(() => readRegistry('@p', join(root, 'dash.json'))).toThrow(InvalidTokenKeyError)
  })
})
