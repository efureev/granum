import { Buffer } from 'node:buffer'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CssSourceError } from '../core/errors'
import { clearCssCache, decodeCssDataUrl, getCssCacheSize, isCssDataUrl, readCss, readCssSync, resolveCssFilePath } from '../node/css'
import { parseCssTokenBlocks, tokenSetFromCss, tokenSetFromCssSync } from '../node/cssTokens'

/**
 * Разрешение источника CSS: что читается, а что не читается в принципе.
 *
 * `CssSourceError` — единственная ошибка контракта, у которой был только тест на
 * конструктор: сообщение проверялось, а поведение — нет. Здесь проверяется
 * поведение, включая границу «ошибка или всё-таки путь»: `file://` читается,
 * `https://` нет, и различие между ними — не догадка, а правило.
 */
describe('resolveCssFilePath', () => {
  it('не-file протокол читать нечем — CssSourceError с причиной', () => {
    expect(() => resolveCssFilePath('https://cdn.example/x.css')).toThrow(CssSourceError)
    try {
      resolveCssFilePath('https://cdn.example/x.css')
      expect.unreachable('ожидалась ошибка')
    }
    catch (error) {
      expect(error).toMatchObject({ code: 'css-source', reason: 'unsupported-protocol', source: 'https://cdn.example/x.css' })
      // Сообщение — на английском и с перечислением того, что поддержано (N-7).
      expect((error as Error).message).toContain('Only local paths')
    }
  })

  it('file:// — это путь, а не ошибка', () => {
    const file = join(tmpdir(), 'granum-css-source.css')
    expect(resolveCssFilePath(pathToFileURL(file).href)).toBe(file)
  })

  it('относительный путь разрешается от переданного корня, абсолютный остаётся собой', () => {
    expect(resolveCssFilePath('theme/tokens.css', '/pkg')).toBe(resolve('/pkg', 'theme/tokens.css'))
    expect(resolveCssFilePath('/abs/theme.css', '/pkg')).toBe('/abs/theme.css')
  })

  it('data:text/css отдаётся как есть: разрешать в путь нечего', () => {
    const source = 'data:text/css,.a{color:red}'
    expect(isCssDataUrl(source)).toBe(true)
    expect(resolveCssFilePath(source, '/pkg')).toBe(source)
  })
})

describe('decodeCssDataUrl', () => {
  it('percent-encoding и base64 дают один и тот же CSS', () => {
    const css = '.a{content:"x,y"}'
    expect(decodeCssDataUrl(`data:text/css,${encodeURIComponent(css)}`)).toBe(css)
    expect(decodeCssDataUrl(`data:text/css;base64,${Buffer.from(css, 'utf8').toString('base64')}`)).toBe(css)
  })

  it('url без запятой — не data URL: CssSourceError, а не пустой CSS', () => {
    // Молча вернуть '' здесь опаснее ошибки: пропавший CSS темы виден только
    // глазами, а на тему смотрят в последнюю очередь.
    expect(() => decodeCssDataUrl('data:text/css')).toThrow(CssSourceError)
    try {
      decodeCssDataUrl('data:text/css')
      expect.unreachable('ожидалась ошибка')
    }
    catch (error) {
      expect(error).toMatchObject({ code: 'css-source', reason: 'invalid-data-url' })
    }
  })
})

describe('readCss / readCssSync', () => {
  it('битый data URL роняет обоих читателей одинаково', async () => {
    expect(() => readCssSync('data:text/css')).toThrow(CssSourceError)
    await expect(readCss('data:text/css')).rejects.toBeInstanceOf(CssSourceError)
  })

  it('файл читается через кеш, но содержимое не устаревает при правке', async () => {
    const root = mkdtempSync(join(tmpdir(), 'granum-css-'))
    const file = join(root, 'theme.css')
    writeFileSync(file, ':root{--a:1}')
    clearCssCache()

    expect(await readCss(file)).toBe(':root{--a:1}')
    expect(getCssCacheSize()).toBe(1)
    expect(await readCss(file)).toBe(':root{--a:1}')

    // Ключ кеша — (mtime, size): правка обязана его промахнуть, иначе
    // dev-сервер раздавал бы старую тему до перезапуска.
    writeFileSync(file, ':root{--a:2;--b:3}')
    expect(await readCss(file)).toBe(':root{--a:2;--b:3}')
  })
})

/**
 * Путь, которым ошибка доходит до пользователя: тему из CSS приложение читает
 * `tokenSetFromCss` (C-13), и туда же попадает ссылка, объявленная провайдером.
 * Без этого теста проверена была бы только чистая функция, а не то, что ошибка
 * не теряется по дороге и не превращается в пустой набор токенов.
 */
describe('tokenSetFromCss / parseCssTokenBlocks', () => {
  it('ссылка на удалённый CSS — CssSourceError, а не пустая тема', async () => {
    await expect(tokenSetFromCss('https://cdn.example/tokens.css')).rejects.toBeInstanceOf(CssSourceError)
    expect(() => tokenSetFromCssSync('https://cdn.example/tokens.css')).toThrow(CssSourceError)
    expect(() => parseCssTokenBlocks('https://cdn.example/tokens.css')).toThrow(CssSourceError)
  })

  it('data:text/css читается как тема', async () => {
    const tokens = await tokenSetFromCss(`data:text/css,${encodeURIComponent(':root{--t-bg:#fff;--t-fg:#111}')}`)

    expect(tokens).toEqual({ selector: ':root', tokens: { 't-bg': '#fff', 't-fg': '#111' } })
  })
})
