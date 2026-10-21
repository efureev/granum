import type { GranumAppTheme } from '../core/resolveThemes'
/**
 * Подготовка приложения читает данные только тех тем, что уйдут в CSS: тем
 * сборки и родителей тем-объектов. Остальные темы каталога не открываются, и
 * сломанный файл темы, которую приложение не выбрало, сборку не валит.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineGranumProvider } from '../contract'
import { InvalidProviderError, ThemeDataError } from '../core/errors'
import { catalogProvider, PAPER, prepareTestApp } from './helpers'

const reads = vi.hoisted(() => [] as string[])

vi.mock('../node/themeFiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../node/themeFiles')>()
  return {
    ...actual,
    readJsonFile: (file: string): unknown => {
      reads.push(file)
      return actual.readJsonFile(file)
    },
  }
})

beforeEach(() => {
  reads.length = 0
})

const themeReads = (): string[] => reads.map(file => file.slice(file.lastIndexOf('/themes/') + 1)).sort()

describe('данные тем, которые читает подготовка', () => {
  it('только активная тема', async () => {
    const { root, provider } = catalogProvider()
    await prepareTestApp({ providers: [provider] }, root)
    expect(themeReads()).toEqual(['themes/paper.json'])
  })

  it('темы сборки — и только они; родитель по каталогу не читается — данные полные', async () => {
    const { root, provider } = catalogProvider()
    await prepareTestApp({ providers: [provider], themes: ['ink'] }, root)
    expect(themeReads()).toEqual(['themes/ink.json'])
    reads.length = 0
    await prepareTestApp({ providers: [provider], themes: [{ theme: 'ink', default: true }, 'paper'] }, root)
    expect(themeReads()).toEqual(['themes/ink.json', 'themes/paper.json'])
  })

  it('родитель темы-объекта читается ради наследника, хотя сам в сборку не входит (A-22)', async () => {
    const { root, provider } = catalogProvider()
    const brand: GranumAppTheme = { id: 'brand', title: 'Бренд', extends: 'ink' }
    await prepareTestApp({ providers: [provider], themes: [brand] }, root)
    expect(themeReads()).toEqual(['themes/ink.json'])
  })

  it('сломанный файл невыбранной темы сборку не валит; выбранной — ThemeDataError', async () => {
    const { root, dist, provider } = catalogProvider()
    rmSync(join(dist, 'themes/ink.json'))
    await expect(prepareTestApp({ providers: [provider] }, root)).resolves.toBeDefined()
    await expect(prepareTestApp({ providers: [provider], themes: ['ink'] }, root)).rejects.toBeInstanceOf(ThemeDataError)
  })
})

/** Несобранный объектный провайдер с каталогом: «Бумага» — данными, «Камень» — исходником. */
function unbuiltProvider(): { root: string, provider: ReturnType<typeof defineGranumProvider> } {
  const root = mkdtempSync(join(tmpdir(), 'granum-unbuilt-'))
  mkdirSync(join(root, 'themes'), { recursive: true })
  writeFileSync(join(root, 'themes/paper.json'), JSON.stringify(PAPER))
  const provider = defineGranumProvider({
    id: '@o/ds',
    contractVersion: 2,
    baseUrl: `${pathToFileURL(root).href}/`,
    components: [],
    theme: { catalog: { paper: { title: 'Бумага', data: 'themes/paper.json' }, stone: { source: 'themes/stone' } } },
  })
  return { root, provider }
}

describe('запись { source } несобранного провайдера (C-43)', () => {
  it('невыбранная — не ошибка: медленный путь собирает манифест без неё', async () => {
    const { root, provider } = unbuiltProvider()
    await expect(prepareTestApp({ providers: [provider], themes: ['paper'] }, root)).resolves.toBeDefined()
  })

  it('выбранная или родитель темы-объекта — theme-source-unbuilt, а не unknown-theme', async () => {
    const { root, provider } = unbuiltProvider()
    const heir: GranumAppTheme = { id: 'heir', title: 'Наследник', extends: 'stone' }
    for (const themes of [['stone'], [heir]]) {
      const failure = await prepareTestApp({ providers: [provider], themes }, root).then(() => undefined, (error: unknown) => error)
      expect(failure, JSON.stringify(themes)).toBeInstanceOf(InvalidProviderError)
      expect((failure as InvalidProviderError).reason).toBe('theme-source-unbuilt')
    }
  })
})
