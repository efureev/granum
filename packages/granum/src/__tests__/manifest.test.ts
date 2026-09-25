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
  parseManifest,
  readManifestSync,
  serializeManifest,
  writeManifestSync,
} from '../node/manifest'

type Draft = Omit<GranumManifest, 'hash'>

function draft(patch: Partial<Draft> = {}): Draft {
  return {
    granum: 1,
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
    engineModule: null,
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

describe('каноническая сериализация (INV-DET-1, manifest.md §5)', () => {
  it('корень в фиксированном порядке, вложенные ключи и массивы строк отсортированы, семантичные массивы — нет', () => {
    const text = serializeManifest(draft())
    const m = parsed(text)
    expect(Object.keys(m)).toEqual(['granum', 'contractVersion', 'id', 'version', 'generatedBy', 'hash', 'dependencies', 'theme', 'engineModule', 'components', 'warnings'])
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

describe('parseManifest — порядок проверок (manifest.md §4; INV-MAN-3)', () => {
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
      parseManifest(ok.replace('"granum": 1', '"granum": 2'), BASE, 'f.json')
      throw new Error('should have thrown')
    }
    catch (e) {
      expect(e).toBeInstanceOf(UnsupportedManifestVersionError)
      expect((e as UnsupportedManifestVersionError).version).toBe(2)
      expect((e as Error).message).toContain('f.json')
    }
  })

  it('3: схема — путь до поля', () => {
    const cases: [string, string][] = [
      [ok.replace('"version": "0.1.0"', '"version": 1'), 'version'],
      [ok.replace('"entry": "components/XhCard/index.js"', '"entry": 7'), 'components.XhCard.entry'],
      [ok.replace('"consumes": []', '"consumes": [1]'), 'components.XhCard.tokens.consumes'],
      [ok.replace('"engineModule": null', '"engineModule": 3'), 'engineModule'],
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

  it('версия контракта проверяется строго', () => {
    const text = serializeManifest({ ...draft(), contractVersion: 2 as unknown as 1 })
    expect(() => parseManifest(text, BASE)).toThrow(UnsupportedContractVersionError)
  })

  it('4: пути — относительные, POSIX, без .. (INV-MAN-2)', () => {
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

  it('5: ручная правка ловится по hash (INV-MAN-1)', () => {
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

  it('6–7: раскладка entry и ключи токенов (INV-MAN-7, INV-CON-7)', () => {
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
    // Зависимости в манифесте отсортированы, поэтому post-order детерминирован (INV-DET-3).
    expect(r.selection.order).toEqual(['@x/simple:XTest1', '@x/heavy:XhCard', '@x/heavy:XhPanel'])
    expect(r.classes).toEqual(['flex', 'gap-2', 'p-4'])
    expect(r.themes.names).toEqual(['light', 'dark'])
  })
})

describe('файлы и поиск через exports (A-2, INV-LAY-2)', () => {
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
