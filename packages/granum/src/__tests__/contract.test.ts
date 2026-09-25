import { describe, expect, it } from 'vitest'
import { defineGranumComponent, defineGranumProvider, GRANUM_CONTRACT_VERSION, resolvePackageBaseUrl } from '../contract'
import {
  DuplicateComponentNameError,
  GranumError,
  InvalidComponentNameError,
  InvalidProviderError,
  InvalidTokenKeyError,
  UnsupportedContractVersionError,
} from '../core/errors'

describe('defineGranumProvider — проверки при регистрации (C-19, INV-ERR-1)', () => {
  const base = { contractVersion: 1 as const, components: [] }

  it('возвращает тот же объект: identity держит дедупликацию графа', () => {
    const p = { id: 'p', ...base }
    expect(defineGranumProvider(p)).toBe(p)
  })

  it.each(['', '   ', 'has space'])('id %j — InvalidProviderError(invalid-id)', (id) => {
    expect(() => defineGranumProvider({ id, ...base })).toThrow(InvalidProviderError)
    try {
      defineGranumProvider({ id, ...base })
    }
    catch (e) {
      expect((e as InvalidProviderError).reason).toBe('invalid-id')
    }
  })

  it('чужая версия контракта, включая БОЛЬШУЮ, — ошибка (INV-CON-3)', () => {
    for (const version of [0, 2, '1']) {
      const bad = { id: 'p', contractVersion: version, components: [] } as unknown as Parameters<typeof defineGranumProvider>[0]
      expect(() => defineGranumProvider(bad)).toThrow(UnsupportedContractVersionError)
    }
    expect(GRANUM_CONTRACT_VERSION).toBe(1)
  })

  it('baseUrl не URL или без завершающего слеша — ошибка с подсказкой (C-6)', () => {
    try {
      defineGranumProvider({ id: 'p', ...base, baseUrl: './dist/' })
      throw new Error('should have thrown')
    }
    catch (e) {
      expect((e as InvalidProviderError).reason).toBe('invalid-base-url')
      expect((e as Error).message).toContain('resolvePackageBaseUrl')
    }
    try {
      defineGranumProvider({ id: 'p', ...base, baseUrl: 'file:///pkg/dist' })
      throw new Error('should have thrown')
    }
    catch (e) {
      expect((e as InvalidProviderError).reason).toBe('base-url-not-a-directory')
    }
  })

  it('components не массив — ошибка', () => {
    const bad = { id: 'p', contractVersion: 1, components: {} } as unknown as Parameters<typeof defineGranumProvider>[0]
    expect(() => defineGranumProvider(bad)).toThrow(InvalidProviderError)
  })

  it('имя компонента — валидный сегмент пути (INV-CON-2)', () => {
    for (const name of ['', '1abc', 'a/b', 'a b', '../x', 'a.b']) {
      expect(() => defineGranumProvider({ id: 'p', ...base, components: [{ name }] }))
        .toThrow(InvalidComponentNameError)
    }
    for (const name of ['Btn', 'XhCard', 'x-y_z', 'a1'])
      expect(() => defineGranumProvider({ id: 'p', ...base, components: [{ name }] })).not.toThrow()
  })

  it('дубль имени компонента — ошибка сразу (INV-CON-1)', () => {
    expect(() => defineGranumProvider({ id: 'p', ...base, components: [{ name: 'A' }, { name: 'A' }] }))
      .toThrow(DuplicateComponentNameError)
  })

  it('ключ токена с `--` — ошибка регистрации, а не молчаливое `----x` (INV-CON-7)', () => {
    expect(() => defineGranumProvider({
      id: 'p',
      ...base,
      theme: { tokenDefinitions: { light: { tokens: { '--brand': '#fff' } } } },
    })).toThrow(InvalidTokenKeyError)

    try {
      defineGranumProvider({
        id: 'p',
        ...base,
        components: [{ name: 'Card', tokenDefinitions: { dark: { tokens: { '--bg': '#000' } } } }],
      })
      throw new Error('should have thrown')
    }
    catch (e) {
      const err = e as InvalidTokenKeyError
      expect(err).toBeInstanceOf(InvalidTokenKeyError)
      expect(err.token).toBe('--bg')
      expect(err.theme).toBe('dark')
      expect(err.componentName).toBe('Card')
    }
  })

  it('cssFiles за пределами components/<Name>/ — ошибка', () => {
    try {
      defineGranumProvider({ id: 'p', ...base, components: [{ name: 'A', cssFiles: ['components/B/styles.css'] }] })
      throw new Error('should have thrown')
    }
    catch (e) {
      expect((e as InvalidProviderError).reason).toBe('css-file-escapes-component')
      expect((e as InvalidProviderError).componentName).toBe('A')
    }
  })

  it('невалидная запись dependencies — ошибка', () => {
    const bad = { id: 'p', ...base, dependencies: ['', 42] } as unknown as Parameters<typeof defineGranumProvider>[0]
    expect(() => defineGranumProvider(bad)).toThrow(InvalidProviderError)
  })

  it('все ошибки — GranumError с кодом (INV-ERR-2)', () => {
    const thrown: unknown[] = []
    for (const call of [
      () => defineGranumProvider({ id: '', ...base }),
      () => defineGranumProvider({ id: 'p', ...base, components: [{ name: '!' }] }),
    ]) {
      try {
        call()
      }
      catch (e) {
        thrown.push(e)
      }
    }
    expect(thrown).toHaveLength(2)
    for (const e of thrown) {
      expect(e).toBeInstanceOf(GranumError)
      expect(typeof (e as GranumError).code).toBe('string')
      expect((e as Error).name).not.toBe('Error')
    }
  })
})

describe('defineGranumComponent (C-18)', () => {
  const url = 'file:///pkg/src/components/XhPanel/config.ts'

  it('cssFiles нормализуются к путям относительно корня раскладки, исходник — в sourceUrl', () => {
    const d = defineGranumComponent(url, { name: 'XhPanel', cssFiles: ['./styles.css', 'css/extra.css', './a/./b.css'] })
    expect(d.cssFiles).toEqual([
      'components/XhPanel/styles.css',
      'components/XhPanel/css/extra.css',
      'components/XhPanel/a/b.css',
    ])
    expect(d.sourceUrl).toBe(url)
    expect(d.dependencies).toEqual([])
    expect(d.safelist).toEqual([])
    expect(d.dynamicTokens).toEqual([])
  })

  it('cssFiles с выходом за директорию компонента — ошибка', () => {
    expect(() => defineGranumComponent(url, { name: 'X', cssFiles: ['../shared.css'] })).toThrow(TypeError)
    expect(() => defineGranumComponent(url, { name: 'X', cssFiles: ['./'] })).toThrow(TypeError)
  })

  it('tokenDefinitionsRef: строка → объект с абсолютным url', () => {
    const d = defineGranumComponent(url, {
      name: 'X',
      tokenDefinitionsRef: { light: './themes/light.css', dark: { url: '../shared/dark.css', as: '.dark', strict: false } },
    })
    expect(d.tokenDefinitionsRef).toEqual({
      light: { url: 'file:///pkg/src/components/XhPanel/themes/light.css' },
      dark: { url: 'file:///pkg/src/components/shared/dark.css', as: '.dark', strict: false },
    })
  })

  it('group и tokenDefinitions проходят как есть; ключ с `--` — ошибка', () => {
    const d = defineGranumComponent(url, { name: 'X', group: 'data', tokenDefinitions: { light: { tokens: { a: '1' } } } })
    expect(d.group).toBe('data')
    expect(d.tokenDefinitions).toEqual({ light: { tokens: { a: '1' } } })
    expect(() => defineGranumComponent(url, { name: 'X', tokenDefinitions: { light: { tokens: { '--a': '1' } } } }))
      .toThrow(InvalidTokenKeyError)
  })

  it('пустой importMetaUrl и невалидное имя — ошибки', () => {
    expect(() => defineGranumComponent('', { name: 'X' })).toThrow(TypeError)
    expect(() => defineGranumComponent(url, { name: 'bad name' })).toThrow(InvalidComponentNameError)
  })
})

describe('resolvePackageBaseUrl', () => {
  it('по умолчанию поднимается на один уровень от модуля', () => {
    expect(resolvePackageBaseUrl('file:///pkg/src/granum-provider/index.ts')).toBe('file:///pkg/src/')
    expect(resolvePackageBaseUrl('file:///pkg/dist/chunks/provider-a1b2.js')).toBe('file:///pkg/dist/')
  })

  it('levelsUp=0 и levelsUp>1', () => {
    expect(resolvePackageBaseUrl('file:///pkg/dist/provider.js', 0)).toBe('file:///pkg/dist/')
    expect(resolvePackageBaseUrl('file:///pkg/dist/a/b/mod.js', 2)).toBe('file:///pkg/dist/')
  })

  it('результат — база для new URL(...), со слешем на конце; работает не только с file:', () => {
    const base = resolvePackageBaseUrl('file:///pkg/dist/chunks/mod.js')
    expect(base.endsWith('/')).toBe(true)
    expect(new URL('components/X/styles.css', base).href).toBe('file:///pkg/dist/components/X/styles.css')
    expect(resolvePackageBaseUrl('https://cdn.example.com/pkg/dist/chunks/mod.js')).toBe('https://cdn.example.com/pkg/dist/')
  })

  it('не даёт уехать выше корня и валидирует аргументы', () => {
    expect(() => resolvePackageBaseUrl('file:///mod.js', 5)).toThrow(RangeError)
    expect(() => resolvePackageBaseUrl('')).toThrow(TypeError)
    expect(() => resolvePackageBaseUrl('no-separator-here')).toThrow(TypeError)
    expect(() => resolvePackageBaseUrl('file:///a/b.js', -1)).toThrow(TypeError)
    expect(() => resolvePackageBaseUrl('file:///a/b.js', 1.5)).toThrow(TypeError)
  })
})
