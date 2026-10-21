import type { GranumConfig } from '../config'
import type { GranumLoadedManifest, GranumProviderInput } from '../contract'
import type { GranumAppTheme, ResolvedTheme } from '../core/resolveThemes'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeResolutionError, ThemeSourceError } from '../core/errors'
import { collectThemeTokens } from '../core/tokenLayers'
import { copyTheme } from '../node/themeCopy'
import { loadThemeSource } from '../node/themeSource'
import { resolveThemeOnly } from '../node/themeStylesheet'
import { catalogProvider, INK, PAPER } from './helpers'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/**
 * Каталог «Бумага» и «Чернила» (наследник) плюс карточка со значениями по темам
 * со стороны компонента (A-24) — у «Бумаги» в обоих режимах, у «Чернил» только в
 * тёмном: светлый «Чернила» берут у родителя.
 */
function setup(): { root: string, provider: GranumProviderInput, config: GranumConfig } {
  const { root, provider } = catalogProvider({
    themes: { paper: PAPER, ink: { ...INK, extends: 'paper' } },
    components: {
      Card: {
        themes: {
          paper: { root: { 'c-radius': '4px' }, modes: { light: { 'c-shade': '#ffffff' }, dark: { 'c-shade': '#000000' } } },
          ink: { modes: { dark: { 'c-shade': '#0b1120' } } },
        },
        tokens: { consumes: ['--c-shade', '--c-radius'], requires: ['--c-shade', '--c-radius'], dynamic: [] },
      },
    },
  })
  roots.push(root)
  return { root, provider, config: { providers: [provider] } as unknown as GranumConfig }
}

/** Действующие значения темы по парам: режим → токен → значение; корень — `root`. */
function valuesByPair(theme: ResolvedTheme, components: Parameters<typeof collectThemeTokens>[1]): Record<string, Record<string, string>> {
  const set = collectThemeTokens(theme, components)
  const out: Record<string, Record<string, string>> = { root: {} }
  for (const [token, chain] of set.root)
    out.root![token] = chain.effective!
  for (const [mode, chains] of set.modes) {
    out[mode] = {}
    for (const [token, chain] of chains)
      out[mode]![token] = chain.effective!
  }
  return out
}

function resolved(root: string, provider: GranumProviderInput, theme: string | GranumAppTheme) {
  const r = resolveThemeOnly({ providers: [provider], themes: [{ theme, default: true, modes: [] }], root })
  return { theme: r.themes.default!.theme, components: r.selection.entries.map(entry => entry.component) }
}

describe('копия темы (D-13, INV-THEME-13)', () => {
  it('значения копии по парам — те же, что у источника, вместе со значениями компонентов', () => {
    const { root, provider, config } = setup()
    for (const source of ['paper', 'ink']) {
      const dest = join(root, `copy-${source}`)
      copyTheme({ source, dest, id: `${source}-copy`, config, root })
      const copy = loadThemeSource(dest)
      expect(copy.extends).toBeUndefined()
      const before = resolved(root, provider, source)
      const after = resolved(root, provider, copy)
      expect(valuesByPair(after.theme, after.components), source).toEqual(valuesByPair(before.theme, before.components))
    }
  })

  it('значения компонента уходят в его раздел, наследование темы раскрыто, режимы — как у источника', () => {
    const { root, config } = setup()
    const dest = join(root, 'moss')
    const result = copyTheme({ source: 'ink', dest, id: 'moss', title: 'Мох', config, root })
    expect(result.files).toEqual([
      'components/@p/ds/Card/modes/dark.json',
      'components/@p/ds/Card/modes/light.json',
      'components/@p/ds/Card/root.json',
      'modes/dark.json',
      'modes/dim.json',
      'modes/light.json',
      'root.json',
      'theme.json',
    ])
    const theme = JSON.parse(readFileSync(join(dest, 'theme.json'), 'utf8'))
    expect(theme).toEqual({
      id: 'moss',
      title: 'Мох',
      version: '0.1.0',
      targets: { '@p/ds': '^0.0.0' },
      modes: { light: { colorScheme: 'light' }, dark: { colorScheme: 'dark' }, dim: { colorScheme: 'dark', extends: 'dark' } },
    })
    expect(JSON.parse(readFileSync(join(dest, 'components/@p/ds/Card/modes/dark.json'), 'utf8'))).toEqual({ 'c-shade': '#0b1120' })
    expect(JSON.parse(readFileSync(join(dest, 'components/@p/ds/Card/modes/light.json'), 'utf8'))).toEqual({ 'c-shade': '#ffffff' })
    expect(JSON.parse(readFileSync(join(dest, 'modes/dim.json'), 'utf8'))).toEqual({ 'p-bg': '#1e293b' })
  })

  it('повторная копия — побайтно тот же исходник', () => {
    const { root, config } = setup()
    const first = copyTheme({ source: 'ink', dest: join(root, 'a'), id: 'moss', config, root })
    const second = copyTheme({ source: 'ink', dest: join(root, 'b'), id: 'moss', config, root })
    for (const file of first.files)
      expect(readFileSync(join(root, 'b', file), 'utf8'), file).toBe(readFileSync(join(root, 'a', file), 'utf8'))
    expect(second.files).toEqual(first.files)
  })

  it('исходник без extends копируется и без конфига; id темы графа без конфига — ошибка', () => {
    const { root, config } = setup()
    copyTheme({ source: 'paper', dest: join(root, 'paper-src'), id: 'paper2', config, root })
    const result = copyTheme({ source: join(root, 'paper-src'), dest: join(root, 'paper3'), id: 'paper3', version: '2.0.0', root })
    expect(result.data.version).toBe('2.0.0')
    expect(loadThemeSource(join(root, 'paper3')).root).toEqual(loadThemeSource(join(root, 'paper-src')).root)
    expect(() => copyTheme({ source: 'paper', dest: join(root, 'x'), id: 'x', root })).toThrow(ThemeResolutionError)
  })

  it('непустая папка назначения и неверный id — отказ', () => {
    const { root, config } = setup()
    mkdirSync(join(root, 'busy'))
    writeFileSync(join(root, 'busy', 'keep.txt'), 'x')
    expect(() => copyTheme({ source: 'paper', dest: join(root, 'busy'), id: 'moss', config, root })).toThrow(ThemeSourceError)
    expect(() => copyTheme({ source: 'paper', dest: join(root, 'y'), id: 'Moss', config, root })).toThrow(ThemeSourceError)
  })
})

describe('пути копии', () => {
  it('относительный dest разрешается от root, а не от cwd', () => {
    const { root, config } = setup()
    copyTheme({ source: 'paper', dest: 'themes/moss', id: 'moss', config, root })
    expect(loadThemeSource(join(root, 'themes/moss')).id).toBe('moss')
  })
})

/** Действующее значение каждого токена в каждой паре: корень, перекрытый режимом. */
function effectiveByPair(theme: ResolvedTheme, components: Parameters<typeof collectThemeTokens>[1]): Record<string, Record<string, string>> {
  const { root, ...modes } = valuesByPair(theme, components)
  return Object.fromEntries(Object.keys(theme.data.modes).map(mode => [mode, { ...root, ...modes[mode] }]))
}

/** Исходник темы на диске: путь → JSON или текст. */
function writeSource(dir: string, files: Record<string, unknown>): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

/**
 * «Бумага» и компоненты со значениями только со стороны компонента: у метки —
 * лишь в светлом режиме (тёмный берёт его через режим по умолчанию), у плашки —
 * в режиме, тогда как тема даёт её токену значение в корне.
 */
function pairSetup(): { root: string, provider: GranumProviderInput, config: GranumConfig } {
  const { root, provider } = catalogProvider({
    themes: { paper: { ...PAPER, root: { ...PAPER.root, 'b-pad': '1px' } } },
    components: {
      Tag: {
        themes: { paper: { modes: { light: { 't-bg': 'from-component' } } } },
        tokens: { consumes: ['--t-bg'], requires: ['--t-bg'], dynamic: [] },
      },
      Badge: {
        themes: { paper: { modes: { light: { 'b-pad': '2px' }, dark: { 'b-pad': '3px' } } } },
        tokens: { consumes: ['--b-pad'], requires: ['--b-pad'], dynamic: [] },
      },
    },
  })
  roots.push(root)
  return { root, provider, config: { providers: [provider] } as unknown as GranumConfig }
}

describe('копия: значение по паре, а не по режиму, из которого оно пришло', () => {
  it('тема-объект над темой каталога: пары копии — те же, что у объекта', () => {
    const { root, provider, config } = pairSetup()
    const reef = writeSource(join(root, 'reef'), {
      'theme.json': { id: 'reef', title: 'Риф', extends: 'paper', modes: { light: {} } },
      'modes/light.json': { 't-bg': 'from-data' },
    })
    const source = resolved(root, provider, loadThemeSource(reef))
    const before = effectiveByPair(source.theme, source.components)
    // Светлый — собственное значение объекта, тёмный — компонента через режим по умолчанию.
    expect([before.light!['t-bg'], before.dark!['t-bg']]).toEqual(['from-data', 'from-component'])
    copyTheme({ source: reef, dest: join(root, 'copy'), id: 'reef-copy', config, root })
    const copy = resolved(root, provider, loadThemeSource(join(root, 'copy')))
    expect(effectiveByPair(copy.theme, copy.components)).toEqual(before)
    expect(JSON.parse(readFileSync(join(root, 'copy/components/@p/ds/Tag/modes/light.json'), 'utf8'))).toEqual({ 't-bg': 'from-data' })
    expect(JSON.parse(readFileSync(join(root, 'copy/components/@p/ds/Tag/modes/dark.json'), 'utf8'))).toEqual({ 't-bg': 'from-component' })
  })

  it('значение темы в корне и значения компонента в режимах — одно место в разделе, а не коллизия', () => {
    const { root, provider, config } = pairSetup()
    const result = copyTheme({ source: 'paper', dest: join(root, 'copy'), id: 'paper-copy', config, root })
    expect(result.data.components?.['@p/ds']?.Badge).toEqual({ modes: { light: { 'b-pad': '2px' }, dark: { 'b-pad': '3px' } } })
    expect(result.data.root['b-pad']).toBeUndefined()
    const before = resolved(root, provider, 'paper')
    const copy = resolved(root, provider, loadThemeSource(join(root, 'copy')))
    expect(effectiveByPair(copy.theme, copy.components)).toEqual(effectiveByPair(before.theme, before.components))
  })

  it('режим, который получает значение по цепочке или из режима по умолчанию, его не дублирует', () => {
    const { root, config } = pairSetup()
    const result = copyTheme({ source: 'paper', dest: join(root, 'copy'), id: 'paper-copy', config, root })
    expect(result.data.components?.['@p/ds']?.Tag).toEqual({ modes: { light: { 't-bg': 'from-component' } } })
  })
})

describe('копия: что переносится из источника', () => {
  const FULL = {
    'theme.json': {
      id: 'dune',
      title: 'Дюна',
      docs: 'https://example.com/dune',
      version: '3.0.0',
      targets: { '@p/ds': '^1.0.0', '@p/other': '^2.0.0' },
      defaultMode: 'light',
      modes: { dark: { colorScheme: 'dark' }, light: { colorScheme: 'light' }, dim: { colorScheme: 'dark', extends: 'dark' } },
      extensions: { acme: { density: 'compact' } },
    },
    'root.json': { 'p-radius': '4px' },
    'base.css': '@font-face { font-family: Dune; src: url(dune.woff2) }\n',
    'modes/light.json': { 'p-bg': '#fffbeb' },
    'modes/dark.json': { 'p-bg': '#1c1917' },
    'components/@p/ds/Card/modes/light.json': { 'c-shade': '#fef3c7' },
  }

  it('порядок режимов, extensions, base.css, раздел и targets — как у источника; docs и version — нет', () => {
    const { root } = setup()
    const source = writeSource(join(root, 'dune'), FULL)
    const result = copyTheme({ source, dest: join(root, 'copy'), id: 'sand', root })
    const theme = JSON.parse(readFileSync(join(root, 'copy/theme.json'), 'utf8'))
    // Порядок источника: не режим по умолчанию первым и не по алфавиту.
    expect(Object.keys(theme.modes)).toEqual(['dark', 'light', 'dim'])
    expect(theme).toEqual({
      id: 'sand',
      title: 'Дюна',
      version: '0.1.0',
      targets: { '@p/ds': '^1.0.0', '@p/other': '^2.0.0' },
      defaultMode: 'light',
      modes: { dark: { colorScheme: 'dark' }, light: { colorScheme: 'light' }, dim: { colorScheme: 'dark', extends: 'dark' } },
      extensions: { acme: { density: 'compact' } },
    })
    expect(readFileSync(join(root, 'copy/base.css'), 'utf8')).toBe(FULL['base.css'])
    expect(result.data.components).toEqual({ '@p/ds': { Card: { modes: { light: { 'c-shade': '#fef3c7' } } } } })
  })

  it('копия копии — тот же исходник, base.css не растёт', () => {
    const { root } = setup()
    const source = writeSource(join(root, 'dune'), FULL)
    const first = copyTheme({ source, dest: join(root, 'a'), id: 'sand', root })
    copyTheme({ source: join(root, 'a'), dest: join(root, 'b'), id: 'sand', root })
    for (const file of first.files)
      expect(readFileSync(join(root, 'b', file), 'utf8'), file).toBe(readFileSync(join(root, 'a', file), 'utf8'))
  })

  it('пакет без версии в графе — targets `*`: раздел без цели копия не прошла бы', () => {
    const { root, provider } = catalogProvider({
      themes: { paper: PAPER },
      components: { Card: { themes: { paper: { root: { 'c-radius': '4px' }, modes: {} } }, tokens: { consumes: ['--c-radius'], requires: ['--c-radius'], dynamic: [] } } },
    })
    roots.push(root)
    // Просканированный манифест версии пакета не знает.
    const scanned: GranumLoadedManifest = { ...provider, manifest: { ...provider.manifest, warnings: [...provider.manifest.warnings, { code: 'scanned-provider' }] } }
    const result = copyTheme({ source: 'paper', dest: join(root, 'copy'), id: 'moss', config: { providers: [scanned] } as unknown as GranumConfig, root })
    expect(result.data.targets).toEqual({ '@p/ds': '*' })
  })

  it('нарушение данных копии — ThemeSourceError с причиной в dataReason', () => {
    const { root, config } = setup()
    let error: unknown
    try {
      copyTheme({ source: 'paper', dest: join(root, 'copy'), id: 'moss', version: 'next', config, root })
    }
    catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(ThemeSourceError)
    expect(error).toMatchObject({ reason: 'theme-data-invalid', dataReason: 'invalid-theme-version' })
  })
})
