import type { Rule } from '../../vendor/core/index.js'
import { h } from '../../vendor/preset-mini/utils.js'
import { parseCssColor } from '../../vendor/rule-utils/index.js'

/** Тип-хинт в скобках: `[color:…]`, `[length:…]`. */
const TYPE_HINT_RE = /^\[([a-z-]+):/i
/** Цветовые функции CSS, которые wind3 не разобрал (`color-mix`, `light-dark`, …). */
const COLOR_FN_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i
/** Слова, которые не цвет. */
const NOT_A_COLOR = new Set(['none', 'auto', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'])

/**
 * Цвет из скобок, к которому альфу ставит это правило, а не wind3.
 *
 * Значение нормализуется тем же `bracketOfColor`, что у wind3: `_` — пробел,
 * `[--x]` — `var(--x)`, хинт `color:` снимается. Цвет, который wind3 разбирает
 * (hex, `rgb`, `hsl`, `oklch`, в том числе с `var()` в компонентах), он
 * раскрашивает сам — альфой в той же функции, без перевода в srgb, — и правило
 * уступает. Не цвет (`2px`, `url(…)`, хинт `length:`) правило не берёт:
 * остаётся вывод wind3 или `unmatched`, который видит диагностика.
 */
function resolveBracketColor(raw: string | undefined): string | undefined {
  if (!raw)
    return undefined
  const hint = TYPE_HINT_RE.exec(raw)?.[1]
  if (hint !== undefined && hint.toLowerCase() !== 'color')
    return undefined
  const color = h.bracketOfColor(raw)
  if (!color || parseCssColor(color))
    return undefined
  return isColorLike(color) ? color : undefined
}

function isColorLike(value: string): boolean {
  if (value.startsWith('var(--') || COLOR_FN_RE.test(value))
    return true
  return /^[a-z]+$/i.test(value) && !NOT_A_COLOR.has(value.toLowerCase())
}

function resolveOpacityPercent(raw: string | undefined): number | undefined {
  // The rule regexes only ever capture `\d+(\.\d+)?`, so a negative sign can
  // never reach here — keep the pattern in sync (no `-?`). Values above 100
  // are clamped to 100 (a `color-mix` percentage can't exceed 100%).
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw))
    return undefined

  const n = Number(raw)
  if (!Number.isFinite(n))
    return undefined

  return Math.min(100, n)
}

function colorMixSrgbTransparent(color: string, opacityPercent: number): string {
  return `color-mix(in srgb, ${color} ${opacityPercent}%, transparent)`
}

export const colorOpacityRules: Rule[] = [
  [
    /^bg-(\[[^\]]+\])\/(\d+(?:\.\d+)?)$/,
    ([, rawColor, rawOpacity]) => {
      const color = resolveBracketColor(rawColor)
      const opacity = resolveOpacityPercent(rawOpacity)
      if (!color || opacity == null)
        return undefined

      return {
        'background-color': colorMixSrgbTransparent(color, opacity),
      }
    },
  ],
  [
    /^border-(\[[^\]]+\])\/(\d+(?:\.\d+)?)$/,
    ([, rawColor, rawOpacity]) => {
      const color = resolveBracketColor(rawColor)
      const opacity = resolveOpacityPercent(rawOpacity)
      if (!color || opacity == null)
        return undefined

      return {
        'border-color': colorMixSrgbTransparent(color, opacity),
      }
    },
  ],
]
