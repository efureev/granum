import { describe, expect, it } from 'vitest'
import { ruleBlocks, tokenValue } from '../lib/cssValues.mjs'

const CSS = [
  '@layer granum.themes{:where(:root),[data-theme=stone-light]{--a:#fff;--b:var(--a)}[data-theme=stone-dark]{--a:#000}}',
  '@supports not (color:color-mix(in oklab,red,red)){[data-theme=stone-light]{--a:#eee}}',
  '[data-theme=stone-light]{--c:1px}',
  '[data-theme=stone-light-hc]{--d:2px}',
].join('\n')

describe('значения токенов по блокам собранного CSS', () => {
  it('блок — его селекторы, объявления и at-правила вокруг', () => {
    expect(ruleBlocks(CSS).map(block => [block.selectors, [...block.declarations.keys()], block.at])).toEqual([
      [[':where(:root)', '[data-theme=stone-light]'], ['--a', '--b'], ['@layer granum.themes']],
      [['[data-theme=stone-dark]'], ['--a'], ['@layer granum.themes']],
      [['[data-theme=stone-light]'], ['--a'], ['@supports not (color:color-mix(in oklab,red,red))']],
      [['[data-theme=stone-light]'], ['--c'], []],
      [['[data-theme=stone-light-hc]'], ['--d'], []],
    ])
  })

  it('значение пары — вне @supports: фолбэк значением пары не считается', () => {
    expect(tokenValue(CSS, '[data-theme=stone-light]', '--a')).toBe('#fff')
    expect(tokenValue(CSS, '[data-theme=stone-light]', '--b')).toBe('var(--a)')
    expect(tokenValue(CSS, '[data-theme=stone-light]', '--c')).toBe('1px')
    expect(tokenValue(CSS, '[data-theme=stone-dark]', '--a')).toBe('#000')
    expect(tokenValue(CSS, '[data-theme=stone-dark]', '--c')).toBeUndefined()
    // Селектор сравнивается целиком: `stone-light` не совпадает с `stone-light-hc`.
    expect(tokenValue(CSS, '[data-theme=stone-light]', '--d')).toBeUndefined()
  })
})
