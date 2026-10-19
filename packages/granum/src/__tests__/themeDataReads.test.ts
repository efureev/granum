/**
 * Подготовка приложения читает данные только тех тем, что уйдут в CSS:
 * активной и превью (T-6). Остальные темы каталога не открываются, и сломанный
 * файл темы, которую приложение не выбрало, сборку не валит.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeDataError } from '../core/errors'
import { catalogProvider, prepareTestApp } from './helpers'

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

  it('активная и превью; родитель по каталогу не читается — данные полные', async () => {
    const { root, provider } = catalogProvider()
    await prepareTestApp({ providers: [provider], theme: 'ink' }, root)
    expect(themeReads()).toEqual(['themes/ink.json'])
    reads.length = 0
    await prepareTestApp({ providers: [provider], theme: 'ink', previews: ['paper'] }, root)
    expect(themeReads()).toEqual(['themes/ink.json', 'themes/paper.json'])
  })

  it('сломанный файл невыбранной темы сборку не валит; выбранной — ThemeDataError', async () => {
    const { root, dist, provider } = catalogProvider()
    rmSync(join(dist, 'themes/ink.json'))
    await expect(prepareTestApp({ providers: [provider] }, root)).resolves.toBeDefined()
    await expect(prepareTestApp({ providers: [provider], theme: 'ink' }, root)).rejects.toBeInstanceOf(ThemeDataError)
  })
})
