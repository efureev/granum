import type { GranumManifest } from '../contract'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InvalidManifestError, ManifestNotFoundError, UnsupportedContractVersionError, UnsupportedManifestVersionError } from '../core/errors'
import { resolveGranum } from '../core/resolve'
import {
  canonicalizeManifest,
  computeManifestHash,
  isPackageRelativePath,
  loadPackageManifest,
  locateManifest,
  normalizePackagePath,
  parseManifest,
  readManifestSync,
  serializeManifest,
  writeManifestSync,
} from '../node/manifest'

type Draft = Omit<GranumManifest, 'hash'>

function draft(patch: Partial<Draft> = {}): Draft {
  return {
    granum: 2,
    contractVersion: 1,
    id: '@x/heavy',
    version: '0.1.0',
    generatedBy: '@feugene/granum@0.0.0-test',
    dependencies: ['@x/simple'],
    theme: {
      tokensCss: 'theme/tokens.css',
      themes: { light: 'theme/light.css', dark: 'theme/dark.css' },
      defaultThemes: ['light', 'dark'],
      tokenDefinitions: { dark: { selector: '.dark', tokens: { bg: '#000' } } },
      declares: ['--xh-bg', '--xh-accent'],
    },
    engine: { dialect: 'unocss/preset-wind3+granum@66', vocabulary: 'fnv64-0123456789abcdef', name: 'granum-engine-wind', version: '66.7.5', module: null },
    components: {
      XhPanel: {
        entry: 'components/XhPanel/index.js',
        files: ['components/XhPanel/index.js', 'components/XhPanel/chunks/XhPanel-a1.js'],
        css: ['components/XhPanel/styles.css', 'components/XhPanel/extra.css'],
        group: null,
        dependencies: ['XhCard', '@x/simple:XTest1'],
        classes: ['gap-2', 'flex'],
        safelist: ['p-2'],
        tokens: { declares: { light: { tokens: { panel: '#fff' } } }, consumes: ['--xh-space-2', '--xh-panel-bg'], dynamic: [] },
        hash: 'sha256-panel',
      },
      XhCard: {
        entry: 'components/XhCard/index.js',
        files: ['components/XhCard/index.js'],
        css: [],
        group: 'data',
        dependencies: [],
        classes: ['p-4'],
        safelist: [],
        tokens: { declares: {}, consumes: [], dynamic: ['--xh-z-*'] },
        hash: 'sha256-card',
      },
    },
    warnings: [{ code: 'safelist-redundant', component: 'XhPanel', classes: ['flex'] }],
    ...patch,
  }
}

const BASE = 'file:///pkg/dist/'

function parsed(text: string): GranumManifest {
  return JSON.parse(text) as GranumManifest
}

describe('каноническая сериализация', () => {
  it('корень в фиксированном порядке, вложенные ключи и массивы строк отсортированы, семантичные массивы — нет', () => {
    const text = serializeManifest(draft())
    const m = parsed(text)
    expect(Object.keys(m)).toEqual(['granum', 'contractVersion', 'id', 'version', 'generatedBy', 'hash', 'dependencies', 'theme', 'engine', 'components', 'warnings'])
    expect(Object.keys(m.components)).toEqual(['XhCard', 'XhPanel'])
    expect(m.components.XhPanel!.classes).toEqual(['flex', 'gap-2'])
    expect(m.components.XhPanel!.dependencies).toEqual(['@x/simple:XTest1', 'XhCard'])
    expect(m.components.XhPanel!.tokens.consumes).toEqual(['--xh-panel-bg', '--xh-space-2'])
    expect(m.theme.declares).toEqual(['--xh-accent', '--xh-bg'])
    // `css` и `defaultThemes` — порядок семантичен.
    expect(m.components.XhPanel!.css).toEqual(['components/XhPanel/styles.css', 'components/XhPanel/extra.css'])
    expect(m.theme.defaultThemes).toEqual(['light', 'dark'])
    expect(text.endsWith('\n')).toBe(true)
  })

  it('порядок ключей и элементов во входе не влияет на текст', () => {
    const a = serializeManifest(draft())
    const shuffled = draft({
      components: { XhPanel: draft().components.XhPanel!, XhCard: draft().components.XhCard! },
      dependencies: ['@x/simple'],
    })
    const panel = shuffled.components.XhPanel!
    const b = serializeManifest({
      ...shuffled,
      components: {
        XhPanel: { ...panel, classes: [...panel.classes].reverse(), files: [...panel.files].reverse() },
        XhCard: shuffled.components.XhCard!,
      },
    })
    expect(b).toBe(a)
    expect(serializeManifest(draft())).toBe(a)
  })

  it('hash считается от текста с пустым hash и стабилен', () => {
    const m = parsed(serializeManifest(draft()))
    expect(m.hash).toMatch(/^sha256-[0-9a-f]{64}$/)
    expect(computeManifestHash(m)).toBe(m.hash)
    expect(computeManifestHash({ ...m, hash: 'anything' })).toBe(m.hash)
    expect(canonicalizeManifest(m)).toBe(serializeManifest(draft()))
  })
})

describe('parseManifest — порядок проверок', () => {
  const ok = serializeManifest(draft())

  it('валидный манифест даёт GranumLoadedManifest с базой', () => {
    const loaded = parseManifest(ok, BASE, 'x.json')
    expect(loaded.baseUrl).toBe(BASE)
    expect(loaded.manifest.id).toBe('@x/heavy')
    expect(() => parseManifest(ok, 'file:///pkg/dist')).toThrow(TypeError)
  })

  it('1–2: не JSON, не объект, чужая версия формата', () => {
    expect(() => parseManifest('{', BASE)).toThrow(InvalidManifestError)
    expect(() => parseManifest('[]', BASE)).toThrow(InvalidManifestError)
    try {
      parseManifest(ok.replace('"granum": 2', '"granum": 1'), BASE, 'f.json')
      throw new Error('should have thrown')
    }
    catch (e) {
      expect(e).toBeInstanceOf(UnsupportedManifestVersionError)
      expect((e as UnsupportedManifestVersionError).version).toBe(1)
      expect((e as Error).message).toContain('f.json')
    }
  })

  it('3: схема — путь до поля', () => {
    const cases: [string, string][] = [
      [ok.replace('"version": "0.1.0"', '"version": 1'), 'version'],
      [ok.replace('"entry": "components/XhCard/index.js"', '"entry": 7'), 'components.XhCard.entry'],
      [ok.replace('"consumes": []', '"consumes": [1]'), 'components.XhCard.tokens.consumes'],
      [ok.replace('"module": null', '"module": 3'), 'engine.module'],
      [ok.replace('"name": "granum-engine-wind"', '"name": 3'), 'engine.name'],
      [ok.replace('"warnings": [', '"warnings": [{},'), 'warnings.0.code'],
    ]
    for (const [text, path] of cases) {
      try {
        parseManifest(text, BASE)
        throw new Error(`should have thrown for ${path}`)
      }
      catch (e) {
        expect(e).toBeInstanceOf(InvalidManifestError)
        expect((e as InvalidManifestError).reason).toBe('schema')
        expect((e as InvalidManifestError).path).toBe(path)
      }
    }
  })

  it('блок engine обязателен и согласован', () => {
    // Без блока `engine` приложение не знает, чем отфильтрован список классов, и
    // догадываться не имеет права — чтение падает.
    const noBlock = ok.replace(/ {2}"engine": \{[^}]*\},\n/, '')
    expect(noBlock).not.toContain('"engine"')
    expect(() => parseManifest(noBlock, BASE)).toThrow(InvalidManifestError)

    const halfNull = ok.replace('"dialect": "unocss/preset-wind3+granum@66"', '"dialect": null')
    try {
      parseManifest(halfNull, BASE)
      throw new Error('should have thrown')
    }
    catch (e) {
      expect((e as InvalidManifestError).reason).toBe('dialect-vocabulary-mismatch')
    }

    // Диалект `null` при непустых классах — потерянная запись о движке.
    const bothNull = halfNull.replace('"vocabulary": "fnv64-0123456789abcdef"', '"vocabulary": null')
    try {
      parseManifest(bothNull, BASE)
      throw new Error('should have thrown')
    }
    catch (e) {
      expect((e as InvalidManifestError).reason).toBe('dialect-without-classes')
    }
  })

  it('версия контракта проверяется строго', () => {
    const text = serializeManifest({ ...draft(), contractVersion: 2 as unknown as 1 })
    expect(() => parseManifest(text, BASE)).toThrow(UnsupportedContractVersionError)
  })

  it('4: пути — относительные, POSIX, без ..', () => {
    for (const bad of ['../x.css', '/abs.css', 'a\\b.css', 'a/../b.css', 'file:///x.css', '', 'a//b.css']) {
      const text = serializeManifest(draft({ theme: { ...draft().theme, baseCss: bad } }))
      try {
        parseManifest(text, BASE)
        throw new Error(`should have thrown for ${bad}`)
      }
      catch (e) {
        expect((e as InvalidManifestError).reason).toBe('path-escapes-package')
        expect((e as InvalidManifestError).path).toBe('theme.baseCss')
      }
    }
    expect(isPackageRelativePath('components/X/styles.css')).toBe(true)
    expect(isPackageRelativePath('./x.css')).toBe(false)
  })

  /**
   * Пути манифеста разрешаются через `new URL(path, baseUrl)`, а парсер URL
   * считает `%2e` точкой: `%2e%2e/x.css` уходит на уровень выше так же, как
   * `../x.css`. Посегментная проверка на `..` такой путь пропускала, и пакет
   * мог подсунуть CSS или модуль правил из-за своих пределов.
   */
  it('4а: закодированные точки — те же сегменты . и ..', () => {
    for (const bad of ['%2e%2e/x.css', '%2E%2e/x.css', '.%2e/x.css', '%2e./x.css', 'a/%2e%2e/b.css', '%2e/x.css']) {
      const text = serializeManifest(draft({ theme: { ...draft().theme, baseCss: bad } }))
      expect(() => parseManifest(text, BASE), bad).toThrow(expect.objectContaining({ reason: 'path-escapes-package' }))
    }
    expect(isPackageRelativePath('a%2eb/x.css')).toBe(true)

    expect(normalizePackagePath('%2e%2e/x.css')).toBeUndefined()
    expect(normalizePackagePath('a/%2E%2e/b.css')).toBe('b.css')
    expect(normalizePackagePath('%2e/x.css')).toBe('x.css')
  })

  it('5: ручная правка ловится по hash', () => {
    const edited = ok.replace('"gap-2"', '"gap-3"')
    try {
      parseManifest(edited, BASE, 'f.json')
      throw new Error('should have thrown')
    }
    catch (e) {
      expect((e as InvalidManifestError).reason).toBe('hash-mismatch')
      expect((e as Error).message).toContain('rebuild the provider')
    }
  })

  it('6–7: раскладка entry и ключи токенов', () => {
    const badEntry = serializeManifest(draft({
      components: { ...draft().components, XhCard: { ...draft().components.XhCard!, entry: 'components/Other/index.js' } },
    }))
    expect(() => parseManifest(badEntry, BASE)).toThrow(/entry/)
    try {
      parseManifest(badEntry, BASE)
    }
    catch (e) {
      expect((e as InvalidManifestError).reason).toBe('entry-layout')
    }

    const badToken = serializeManifest(draft({
      theme: { ...draft().theme, tokenDefinitions: { dark: { tokens: { '--bg': '#000' } } } },
    }))
    try {
      parseManifest(badToken, BASE)
      throw new Error('should have thrown')
    }
    catch (e) {
      expect((e as InvalidManifestError).reason).toBe('token-key-prefix')
      expect((e as InvalidManifestError).path).toBe('theme.tokenDefinitions.dark.tokens')
    }
  })

  it('результат разбора пригоден резолверу', () => {
    const loaded = parseManifest(ok, BASE)
    const simple = parseManifest(serializeManifest(draft({ id: '@x/simple', dependencies: [], components: { XTest1: { ...draft().components.XhCard!, entry: 'components/XTest1/index.js', group: null } } })), 'file:///simple/dist/')
    const r = resolveGranum({ providers: [loaded, simple], components: ['@x/heavy:XhPanel'] })
    // Зависимости в манифесте отсортированы, поэтому post-order детерминирован.
    expect(r.selection.order).toEqual(['@x/simple:XTest1', '@x/heavy:XhCard', '@x/heavy:XhPanel'])
    expect(r.classes).toEqual(['flex', 'gap-2', 'p-4'])
    expect(r.themes.names).toEqual(['light', 'dark'])
  })
})

describe('файлы и поиск через exports', () => {
  it('writeManifestSync → readManifestSync: побайтно тот же текст, база — директория файла', () => {
    const dir = mkdtempSync(join(tmpdir(), 'granum-manifest-'))
    const file = join(dir, 'dist', 'granum.manifest.json')
    writeManifestSync(file, draft())
    const text = readFileSync(file, 'utf8')
    expect(text).toBe(serializeManifest(draft()))
    const loaded = readManifestSync(file)
    expect(loaded.baseUrl.endsWith('/dist/')).toBe(true)
    expect(loaded.baseUrl.startsWith('file://')).toBe(true)
    expect(loaded.manifest.id).toBe('@x/heavy')
    expect(() => readManifestSync(join(dir, 'missing.json'))).toThrow(InvalidManifestError)
  })

  it('locateManifest находит манифест по exports пакета из node_modules приложения', () => {
    const app = mkdtempSync(join(tmpdir(), 'granum-app-'))
    const pkg = join(app, 'node_modules', '@x', 'heavy')
    mkdirSync(join(pkg, 'dist'), { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({
      name: '@x/heavy',
      version: '0.1.0',
      type: 'module',
      exports: { '.': './dist/index.js', './granum.manifest.json': './dist/granum.manifest.json' },
    }))
    writeManifestSync(join(pkg, 'dist', 'granum.manifest.json'), draft())

    expect(realpathSync(locateManifest('@x/heavy', app))).toBe(realpathSync(join(pkg, 'dist', 'granum.manifest.json')))
    expect(loadPackageManifest('@x/heavy', app).manifest.id).toBe('@x/heavy')

    // Пакет без экспорта манифеста — типизированная ошибка с подсказкой.
    const other = join(app, 'node_modules', '@x', 'plain')
    mkdirSync(join(other, 'dist'), { recursive: true })
    writeFileSync(join(other, 'package.json'), JSON.stringify({ name: '@x/plain', version: '1.0.0', exports: { '.': './dist/index.js' } }))
    try {
      locateManifest('@x/plain', app)
      throw new Error('should have thrown')
    }
    catch (e) {
      expect(e).toBeInstanceOf(ManifestNotFoundError)
      expect((e as Error).message).toContain('granum codegen')
      expect((e as ManifestNotFoundError).cause).toBeDefined()
    }
    expect(() => locateManifest('@x/absent', app)).toThrow(ManifestNotFoundError)
  })
})
