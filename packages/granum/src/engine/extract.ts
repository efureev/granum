/**
 * Извлечение классов (E-6). Токенизация — вендоренный экстрактор preset-mini
 * (`splitCodeWithArbitraryVariants`), а перед ней срезаются комментарии:
 * UnoCSS сканирует ТЕКСТ файла, и `<!-- p-4 -->` в шаблоне SFC давал бы
 * утилиту (INV-ENG-5).
 *
 * Границы намеренно простые и документированные: HTML-комментарии в
 * `.vue`/`.html`/`.svelte`, блочные комментарии везде, строчные — только
 * строки, начинающиеся с двух слешей (URL внутри строк не трогаются).
 */
import { splitCodeWithArbitraryVariants } from './vendor/extractor-arbitrary-variants/index.js'

const HTML_LIKE = /\.(?:vue|html|htm|svelte|astro)$/i

export function stripComments(code: string, id: string): string {
  let out = code
  if (HTML_LIKE.test(id))
    out = out.replace(/<!--[\s\S]*?-->/g, ' ')
  out = out.replace(/\/\*[\s\S]*?\*\//g, ' ')
  out = out.replace(/^[ \t]*\/\/[^\n]*$/gm, '')
  return out
}

export function extractClasses(code: string, id: string): Set<string> {
  const set = new Set<string>()
  for (const token of splitCodeWithArbitraryVariants(stripComments(code, id))) {
    if (token.length > 0)
      set.add(token)
  }
  return set
}
