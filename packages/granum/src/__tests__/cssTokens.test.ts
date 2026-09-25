import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseCssTokenBlocks, tokenSetFromCss, tokenSetFromCssSync } from '../node/cssTokens'

const ROOT_CSS = `
:root {
  --brd: #e2e8f0;
  --card: #ffffff;
  --card-fg: #0f172a;
}
`

const MULTI_BLOCKS_CSS = `
/* comment with { curly } inside */
:root {
  --brd: #e2e8f0;
}

.dark, [data-theme="dark"] {
  --brd: #334155;
  --accent: var(--brand, blue);
}
`

const EMPTY_CSS = `
/* no custom properties here */
.foo { color: red; }
`

function toDataUrl(css: string): string {
  return `data:text/css,${encodeURIComponent(css)}`
}

describe('tokenSetFromCss (data URLs)', () => {
  it('parses :root from data URL', async () => {
    const result = await tokenSetFromCss(toDataUrl(ROOT_CSS))
    expect(result).toEqual({
      selector: ':root',
      tokens: {
        'brd': '#e2e8f0',
        'card': '#ffffff',
        'card-fg': '#0f172a',
      },
    })
  })

  it('sync variant returns same result', () => {
    const result = tokenSetFromCssSync(toDataUrl(ROOT_CSS))
    expect(result.selector).toBe(':root')
    expect(result.tokens.brd).toBe('#e2e8f0')
  })

  it('respects `as` to override the resulting selector', async () => {
    const result = await tokenSetFromCss(toDataUrl(ROOT_CSS), { as: '.dark' })
    expect(result.selector).toBe('.dark')
    expect(result.tokens.brd).toBe('#e2e8f0')
  })

  it('picks the block matching the requested selector when multiple exist', async () => {
    const result = await tokenSetFromCss(toDataUrl(MULTI_BLOCKS_CSS), {
      selector: '.dark, [data-theme="dark"]',
    })
    expect(result.selector).toBe('.dark, [data-theme="dark"]')
    expect(result.tokens.brd).toBe('#334155')
    expect(result.tokens.accent).toBe('var(--brand, blue)')
  })

  it('throws in strict mode when the requested selector is not found', async () => {
    await expect(
      tokenSetFromCss(toDataUrl(MULTI_BLOCKS_CSS), { selector: '.unknown' }),
    ).rejects.toThrow(/[Ss]elector ".unknown" not found/)
    // Типизированный класс: reason + список доступных селекторов в полях.
    await expect(
      tokenSetFromCss(toDataUrl(MULTI_BLOCKS_CSS), { selector: '.unknown' }),
    ).rejects.toMatchObject({
      name: 'TokenParseError',
      reason: 'selector-not-found',
      available: [':root', '.dark, [data-theme="dark"]'],
    })
  })

  it('falls back to the first block in non-strict mode', async () => {
    const result = await tokenSetFromCss(toDataUrl(MULTI_BLOCKS_CSS), {
      selector: '.unknown',
      strict: false,
    })
    expect(result.selector).toBe(':root')
    expect(result.tokens.brd).toBe('#e2e8f0')
  })

  it('throws in strict mode when no custom properties are present', async () => {
    await expect(
      tokenSetFromCss(toDataUrl(EMPTY_CSS)),
    ).rejects.toThrow(/[Nn]o CSS custom properties/)
    await expect(
      tokenSetFromCss(toDataUrl(EMPTY_CSS)),
    ).rejects.toMatchObject({ name: 'TokenParseError', reason: 'no-tokens' })
  })

  it('returns empty tokens in non-strict mode when nothing is found', async () => {
    const result = await tokenSetFromCss(toDataUrl(EMPTY_CSS), { strict: false })
    expect(result).toEqual({ selector: ':root', tokens: {} })
  })
})

describe('tokenSetFromCss (file URLs)', () => {
  let dir: string
  let lightPath: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'granular-tokens-'))
    lightPath = join(dir, 'light.css')
    writeFileSync(lightPath, ROOT_CSS, 'utf8')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads file by absolute path', async () => {
    const result = await tokenSetFromCss(lightPath)
    expect(result.tokens.card).toBe('#ffffff')
  })

  it('reads file by file:// URL (async & sync)', async () => {
    const url = pathToFileURL(lightPath).href
    const asyncResult = await tokenSetFromCss(url)
    const syncResult = tokenSetFromCssSync(url)
    expect(asyncResult).toEqual(syncResult)
    expect(asyncResult.tokens['card-fg']).toBe('#0f172a')
  })
})

const DARK_COMPOUND_CSS = `
.theme-dark,
.dark,
[data-theme='dark'] {
    --card: #1e293b;
    --card-fg: #f8fafc;
    --brd: #334155;
}
`

describe('tokenSetFromCss (compound multi-line selector)', () => {
  // Реальный кейс: packages/simple-package/src/styles/themes/dark.css —
  // один блок с тремя селекторами, разнесёнными по строкам.
  const EXPECTED_SELECTOR = `.theme-dark, .dark, [data-theme='dark']`
  const EXPECTED_TOKENS = {
    'card': '#1e293b',
    'card-fg': '#f8fafc',
    'brd': '#334155',
  }

  it('нормализует multi-line compound selector в одну строку', async () => {
    const blocks = parseCssTokenBlocks(toDataUrl(DARK_COMPOUND_CSS))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.selector).toBe(EXPECTED_SELECTOR)
    expect(blocks[0]!.tokens).toEqual(EXPECTED_TOKENS)
  })

  it('подхватывает единственный блок с compound selector без опций (single-block fallback)', async () => {
    const result = await tokenSetFromCss(toDataUrl(DARK_COMPOUND_CSS))
    // При `selector: ':root'` (по умолчанию) точного совпадения нет, но блок один — берём его.
    expect(result.selector).toBe(EXPECTED_SELECTOR)
    expect(result.tokens).toEqual(EXPECTED_TOKENS)
  })

  it('точное совпадение compound selector + override через `as`', async () => {
    const result = await tokenSetFromCss(toDataUrl(DARK_COMPOUND_CSS), {
      selector: EXPECTED_SELECTOR,
      as: '.dark, [data-theme="dark"]',
    })
    expect(result.selector).toBe('.dark, [data-theme="dark"]')
    expect(result.tokens).toEqual(EXPECTED_TOKENS)
  })

  it('эмулирует реальное использование: tokenSetFromCssSync с `as`', () => {
    // Повторяет вызов из packages/simple-package/src/granular-provider/index.ts
    const result = tokenSetFromCssSync(toDataUrl(DARK_COMPOUND_CSS), {
      as: '.dark, [data-theme="dark"]',
    })
    expect(result.selector).toBe('.dark, [data-theme="dark"]')
    expect(result.tokens.brd).toBe('#334155')
    expect(result.tokens.card).toBe('#1e293b')
    expect(result.tokens['card-fg']).toBe('#f8fafc')
  })
})

describe('parseCssCustomPropertyBlocks', () => {
  it('returns all blocks in document order', async () => {
    const blocks = parseCssTokenBlocks(toDataUrl(MULTI_BLOCKS_CSS))
    expect(blocks.map(b => b.selector)).toEqual([
      ':root',
      '.dark, [data-theme="dark"]',
    ])
    expect(blocks[1]!.tokens.accent).toBe('var(--brand, blue)')
  })

  it('accepts raw CSS literals', () => {
    const blocks = parseCssTokenBlocks(MULTI_BLOCKS_CSS)
    expect(blocks).toHaveLength(2)
  })

  it('skips blocks without custom properties', () => {
    const blocks = parseCssTokenBlocks(`
      .foo { color: red; }
      :root { --a: 1; }
    `)
    expect(blocks).toEqual([{ selector: ':root', tokens: { a: '1' } }])
  })
})

describe('парсер: последнее объявление без `;`', () => {
  it('подхватывает последний токен без точки с запятой', () => {
    expect(parseCssTokenBlocks(':root { --a: 1px; --b: 2px }')).toEqual([
      { selector: ':root', tokens: { a: '1px', b: '2px' } },
    ])
  })

  it('работает и для единственного объявления без `;`', () => {
    expect(parseCssTokenBlocks(':root{--a:1px}')).toEqual([
      { selector: ':root', tokens: { a: '1px' } },
    ])
  })
})

describe('парсер: вложенность и at-rules', () => {
  const NESTED = '.dark { :root { --a: 1px; } }'
  const AT_RULE = '@media (min-width: 100px) { :root { --a: 1px; } }'

  it('не выдаёт внутренний селектор at-rule-блока как блок верхнего уровня', () => {
    expect(parseCssTokenBlocks(AT_RULE)).toEqual([])
  })

  it('не выдаёт вложенный блок как блок верхнего уровня', () => {
    expect(parseCssTokenBlocks(NESTED)).toEqual([])
  })

  it('плоские блоки рядом с вложенными разбираются корректно', () => {
    expect(parseCssTokenBlocks(`${AT_RULE} :root { --b: 2px }`)).toEqual([
      { selector: ':root', tokens: { b: '2px' } },
    ])
  })

  it('объявления собственного уровня не теряются из-за вложенного блока', () => {
    expect(parseCssTokenBlocks(':root { --a: 1px; @media print { --b: 2px } --c: 3px }')).toEqual([
      { selector: ':root', tokens: { a: '1px', c: '3px' } },
    ])
  })

  it('strict-режим бросает типизированную ошибку вместо тихой порчи темы', () => {
    expect(() => tokenSetFromCssSync(toDataUrl(NESTED)))
      .toThrow(/Only flat top-level blocks/)
    try {
      tokenSetFromCssSync(toDataUrl(NESTED))
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as Error).name).toBe('TokenParseError')
      expect((error as { reason?: string }).reason).toBe('unsupported-blocks')
    }
  })

  it('в non-strict возвращает только плоские блоки', () => {
    const result = tokenSetFromCssSync(
      toDataUrl(`:root { --a: 1px }${NESTED}`),
      { strict: false },
    )
    expect(result).toEqual({ selector: ':root', tokens: { a: '1px' } })
  })
})
