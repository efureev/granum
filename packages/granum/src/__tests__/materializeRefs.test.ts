import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defineGranumComponent } from '../contract'
import { TokenRefError } from '../core/errors'
import { materializeComponentRefs, materializeProviderRefs } from '../node/materializeRefs'
import { makeProvider } from './helpers'

const dataUrl = (css: string): string => `data:text/css,${encodeURIComponent(css)}`

describe('materializeProviderRefs (C-13, INV-THM-5, INV-THM-6)', () => {
  it('ссылки компонента читаются, литералы важнее, поле ref исчезает', () => {
    const descriptor = defineGranumComponent('file:///pkg/src/components/X/config.ts', {
      name: 'X',
      tokenDefinitions: { light: { tokens: { bg: '#lit' } } },
      tokenDefinitionsRef: {
        light: dataUrl(':root{--bg:#file;--fg:#000}'),
        dark: { url: dataUrl('.dark{--bg:#111}'), as: '[data-theme="dark"]' },
      },
    })
    const provider = makeProvider('p', { components: [descriptor] })
    const out = materializeProviderRefs(provider)
    expect(out).not.toBe(provider)
    const x = out.components[0]!
    expect(x.tokenDefinitionsRef).toBeUndefined()
    expect(x.tokenDefinitions).toEqual({
      light: { tokens: { bg: '#lit' } },
      dark: { selector: '[data-theme="dark"]', tokens: { bg: '#111' } },
    })
  })

  it('без ссылок возвращается тот же объект — на идентичности держится граф', () => {
    const provider = makeProvider('p', { components: [{ name: 'A', tokenDefinitions: { light: { tokens: { a: '1' } } } }] })
    expect(materializeProviderRefs(provider)).toBe(provider)
    expect(materializeComponentRefs(provider.components[0]!, 'p')).toBe(provider.components[0])
  })

  it('читаются только нужные темы; ссылка неактивной темы не открывается (INV-THM-5)', () => {
    const descriptor = defineGranumComponent('file:///pkg/src/components/X/config.ts', {
      name: 'X',
      tokenDefinitionsRef: { light: dataUrl(':root{--a:1}'), broken: 'file:///nowhere/never.css' },
    })
    const out = materializeComponentRefs(descriptor, 'p', new Set(['light']))
    expect(out.tokenDefinitions).toEqual({ light: { selector: ':root', tokens: { a: '1' } } })
    expect(() => materializeComponentRefs(descriptor, 'p')).toThrow(TokenRefError)
  })

  it('пакетные ссылки провайдера: строка относительно baseUrl, объект с селектором', () => {
    const dir = mkdtempSync(join(tmpdir(), 'granum-refs-'))
    writeFileSync(join(dir, 'light.css'), ':root{--brand:red}\n.dark{--brand:blue}')
    const provider = makeProvider('p', {
      baseUrl: `${pathToFileURL(dir).href}/`,
      theme: { tokenDefinitionsRef: { light: 'light.css', dark: { url: 'light.css', selector: '.dark' } } },
    })
    const out = materializeProviderRefs(provider)
    expect(out.theme!.tokenDefinitionsRef).toBeUndefined()
    expect(out.theme!.tokenDefinitions).toEqual({
      light: { selector: ':root', tokens: { brand: 'red' } },
      dark: { selector: '.dark', tokens: { brand: 'blue' } },
    })
  })

  it('ошибка чтения — TokenRefError с провайдером, компонентом, темой и причиной', () => {
    const descriptor = defineGranumComponent('file:///pkg/src/components/X/config.ts', {
      name: 'X',
      tokenDefinitionsRef: { light: dataUrl('.foo{color:red}') },
    })
    try {
      materializeComponentRefs(descriptor, '@x/p')
      throw new Error('should have thrown')
    }
    catch (e) {
      const err = e as TokenRefError
      expect(err).toBeInstanceOf(TokenRefError)
      expect(err.providerId).toBe('@x/p')
      expect(err.componentName).toBe('X')
      expect(err.themeName).toBe('light')
      expect((err.cause as Error).name).toBe('TokenParseError')
      expect(err.message).toContain('no-tokens'.replace('no-tokens', 'No CSS custom properties'))
    }
  })
})
