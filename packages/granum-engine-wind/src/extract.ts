/**
 * Извлечение классов словаря preset-wind3: токенизация вендоренным экстрактором
 * (`splitCodeWithArbitraryVariants`) — он понимает произвольные значения со
 * скобками, чего простой сплиттер ядра не умеет. Срезание комментариев берётся
 * у ядра (`stripComments`): UnoCSS сканирует ТЕКСТ файла, и `<!-- p-4 -->` в
 * шаблоне SFC давал бы утилиту (INV-ENG-5).
 */
import { stripComments } from '@feugene/granum/engine'
import { splitCodeWithArbitraryVariants } from './vendor/extractor-arbitrary-variants/index.js'

export function extractWindClasses(code: string, id: string): Set<string> {
  const set = new Set<string>()
  for (const token of splitCodeWithArbitraryVariants(stripComments(code, id))) {
    if (token.length > 0)
      set.add(token)
  }
  return set
}
