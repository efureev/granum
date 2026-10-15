/**
 * Раскрытие `@apply` в CSS компонента на сборке провайдера (B-11, ADR-3):
 * только внутри плоских правил, декларации берутся у движка. Вложенные
 * контексты, варианты и классы без правила — ошибка сборки, а не молчание.
 */
import type { GranumEngine } from '../engine/types'
import { ApplyExpansionError } from '../core/errors'
import { scanCssBlocks } from '../node/cssDeclarations'

/**
 * Директива с завершающей `;` и без неё: последняя в правиле перед `}` пишется
 * без точки с запятой (и так её оставляет минификатор), а нераскрытая
 * директива уехала бы в `dist` молча.
 */
const APPLY_RE = /@apply\b([^;{}]*);?/g

function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
}

export function hasApply(css: string): boolean {
  return /@apply\b/.test(blankComments(css))
}

export async function expandApply(css: string, engine: GranumEngine, file: string): Promise<string> {
  if (!hasApply(css))
    return css

  const { blocks } = scanCssBlocks(css)
  const flatRanges = collectFlatRanges(blocks)

  // Комментарии гасятся пробелами той же длины: смещения совпадений остаются
  // верными для исходного текста, а `@apply` внутри `/* … */` директивой не считается.
  const searchable = blankComments(css)
  const replacements: { start: number, end: number, text: string }[] = []
  for (const match of searchable.matchAll(APPLY_RE)) {
    const start = match.index
    const terminated = match[0].endsWith(';')
    // Без `;` пробелы перед `}` не часть директивы: перевод строки остаётся на месте.
    const end = start + (terminated ? match[0].length : match[0].trimEnd().length)
    const directive = css.slice(start, end)
    if (!terminated && searchable[start + match[0].length] === '{')
      throw new ApplyExpansionError(file, 'nested-context', `'${directive}' opens a block; @apply is a declaration inside a flat top-level rule`)
    const inFlat = flatRanges.some(r => start >= r.bodyStart && end <= r.end)
    if (!inFlat)
      throw new ApplyExpansionError(file, 'nested-context', `'${directive}' is not inside a flat top-level rule`)
    const classes = match[1]!.split(/\s+/).filter(Boolean)
    // По одному классу: в выводе только его правила, и движок не сольёт
    // одинаковые тела разных классов в список селекторов.
    const outputs = await Promise.all(classes.map(cls => engine.generate({ classes: new Set([cls]) })))
    const unmatched = outputs.flatMap(out => out.unmatched)
    if (unmatched.length > 0)
      throw new ApplyExpansionError(file, 'unmatched-class', `no rule for ${unmatched.map(c => `'${c}'`).join(', ')}`)
    const declarations = classes.map((cls, i) => declarationsOf(outputs[i]!.css, outputs[i]!.matched.get(cls)!.selector, cls, file))
    replacements.push({ start, end, text: declarations.join('') })
  }

  let result = css
  for (const r of replacements.sort((a, b) => b.start - a.start))
    result = result.slice(0, r.start) + r.text + result.slice(r.end)
  return result
}

interface FlatRange {
  readonly bodyStart: number
  readonly end: number
}

function collectFlatRanges(blocks: ReturnType<typeof scanCssBlocks>['blocks']): FlatRange[] {
  const out: FlatRange[] = []
  for (const block of blocks) {
    if (block.prelude.startsWith('@') || block.children.length > 0)
      continue
    out.push({ bodyStart: block.bodyStart, end: block.end })
  }
  return out
}

/**
 * Декларации класса из его собственного вывода движка.
 *
 * Плоское правило — ровно один блок верхнего уровня с селектором самого
 * класса. Вариант через at-rule (`md:`, `print:`, `supports-[…]:`) кладёт
 * правило под `@media`/`@supports` с тем же селектором, а `container`
 * добавляет к плоскому правилу блоки `@media`: раскрыв такие в декларации,
 * сборка молча сделала бы условное безусловным.
 */
function declarationsOf(generated: string, selector: string, cls: string, file: string): string {
  // Движок ставит перед правилами комментарий слоя (`/* layer: default */`), а
  // прелюдия блока захватывает всё до `{`: гашение пробелами оставляет её чистой.
  const source = blankComments(generated)
  const { blocks } = scanCssBlocks(source)
  const block = blocks[0]
  if (blocks.length !== 1 || !block)
    throw new ApplyExpansionError(file, 'non-flat-rule', `'${cls}' expands to ${blocks.length} rules, not one flat rule`)
  if (block.prelude.startsWith('@') || block.children.length > 0)
    throw new ApplyExpansionError(file, 'non-flat-rule', `'${cls}' expands under '${block.prelude}', not to a flat rule`)
  if (block.prelude !== selector || selector !== `.${cssEscape(cls)}`)
    throw new ApplyExpansionError(file, 'non-flat-rule', `'${cls}' does not expand to a flat rule (selector '${selector}')`)
  const body = source.slice(block.bodyStart, block.end - 1).trim()
  return body.endsWith(';') ? body : `${body};`
}

function cssEscape(cls: string): string {
  return cls.replace(/[^\w-]/g, ch => `\\${ch}`)
}
