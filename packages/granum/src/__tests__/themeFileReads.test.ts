/**
 * Подготовка приложения читает только те темы, которые понадобятся резолву:
 * активные и базы `extends`. Файл темы, которую перекрыло структурное
 * определение того же провайдера, не открывается вовсе, а сломанная ссылка
 * темы, которую приложение не включало, сборку не валит.
 */
import type { GranumProvider } from '../contract'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileThemeProvider, makeManifest, prepareTestApp } from './helpers'

const reads = vi.hoisted(() => [] as string[])

vi.mock('../node/css', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../node/css')>()
  return {
    ...actual,
    readCssSync: (file: string): string => {
      reads.push(file)
      return actual.readCssSync(file)
    },
  }
})

beforeEach(() => {
  reads.length = 0
})

const themeReads = (): string[] => reads.filter(file => /\/theme\/\w+\.css$/.test(file)).map(file => file.slice(file.lastIndexOf('/theme/') + 1))

describe('файлы тем, которые читает подготовка', () => {
  it('неактивная тема не открывается', async () => {
    const { root, provider } = fileThemeProvider()
    await prepareTestApp({ providers: [provider], components: [], themes: { names: ['light'] } }, root)
    expect(themeReads()).toEqual(['theme/light.css'])
  })

  it('база `extends` открывается: её значения наследует тема приложения', async () => {
    const { root, provider } = fileThemeProvider()
    await prepareTestApp({ providers: [provider], components: [], themes: { names: ['light', 'ocean'], define: { ocean: { extends: 'dark' } } } }, root)
    expect(themeReads().sort()).toEqual(['theme/dark.css', 'theme/light.css'])
  })

  it('файл темы, у которой провайдер дал структурное определение, не открывается', async () => {
    const { root, provider } = fileThemeProvider()
    const structural = makeManifest('@p/ds', { Plain: {} }, {
      theme: {
        ...provider.manifest.theme,
        tokenDefinitions: { dark: { selector: '.dark', tokens: { 'p-bg': '#000000' } } },
      },
    })
    await prepareTestApp({ providers: [{ manifest: structural.manifest, baseUrl: provider.baseUrl }], components: [], themes: { names: ['light', 'dark'] } }, root)
    expect(themeReads()).toEqual(['theme/light.css'])
  })
})

describe('ссылки на токены объектного провайдера', () => {
  const broken = (): GranumProvider => ({
    id: '@p/obj',
    contractVersion: 1,
    components: [{ name: 'Card', tokenDefinitionsRef: { dark: { url: 'file:///nonexistent/dark-card.css' } } }],
    theme: { defaultThemes: ['light'] },
  })

  it('сломанная ссылка неактивной темы сборку не валит', async () => {
    const root = mkdtempSync(join(tmpdir(), 'granum-needed-refs-'))
    await expect(prepareTestApp({ providers: [broken()], components: [], themes: { names: ['light'] } }, root)).resolves.toBeDefined()
  })

  it('та же ссылка у активной темы — ошибка чтения', async () => {
    const root = mkdtempSync(join(tmpdir(), 'granum-needed-refs-'))
    await expect(prepareTestApp({ providers: [broken()], components: [], themes: { names: ['light', 'dark'] } }, root)).rejects.toThrow(/dark-card\.css/)
  })
})
