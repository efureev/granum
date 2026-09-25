/**
 * Раскрытие `@apply` в CSS компонента на сборке провайдера (B-11, ADR-3):
 * только внутри плоских правил, декларации берутся у движка. Вложенные
 * контексты, варианты и классы без правила — ошибка сборки, а не молчание.
 */
import type { GranumEngine } from '../engine/types'
import { ApplyExpansionError } from '../core/errors'
import { scanCssBlocks } from '../node/cssDeclarations'

const APPLY_RE = /@apply([^;{}]*);/g

// `hasApply` использует `test` без состояния: у глобального регэкспа сбрасывается lastIndex.
function resetApplyRe(): void {
  APPLY_RE.lastIndex = 0
}

export function hasApply(css: string): boolean {
  return APPLY_RE.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))
}

export async function expandApply(css: string, engine: GranumEngine, file: string): Promise<string> {
  resetApplyRe()
  if (!hasApply(css))
    return css
  resetApplyRe()

  const { blocks } = scanCssBlocks(css)
  const flatRanges = collectFlatRanges(blocks)

  // Комментарии гасятся пробелами той же длины: смещения совпадений остаются
  // верными для исходного текста, а `@apply` внутри `/* … */` директивой не считается.
  const searchable = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
  const matches = [...searchable.matchAll(APPLY_RE)]
  const replacements: { start: number, end: number, text: string }[] = []
  for (const match of matches) {
    const start = match.index
    const end = start + match[0].length
    const inFlat = flatRanges.some(r => start >= r.bodyStart && end <= r.end)
    if (!inFlat)
      throw new ApplyExpansionError(file, 'nested-context', `'${match[0].trim()}' is not inside a flat top-level rule`)
    const classes = match[1]!.split(/\s+/).filter(Boolean)
    const out = await engine.generate({ classes: new Set(classes) })
    if (out.unmatched.length > 0)
      throw new ApplyExpansionError(file, 'unmatched-class', `no rule for ${out.unmatched.map(c => `'${c}'`).join(', ')}`)
    const declarations = classes.map(cls => declarationsOf(out.css, out.matched.get(cls)!.selector, cls, file))
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

/** Декларации правила `.cls{...}` из вывода движка; вариант или вложение — не плоское правило. */
function declarationsOf(generated: string, selector: string, cls: string, file: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(`(?:^|\\n)${escaped}\\{([^}]*)\\}`).exec(generated)
  if (!rule || selector !== `.${cssEscape(cls)}`)
    throw new ApplyExpansionError(file, 'non-flat-rule', `'${cls}' does not expand to a flat rule (selector '${selector}')`)
  const body = rule[1]!.trim()
  return body.endsWith(';') ? body : `${body};`
}

function cssEscape(cls: string): string {
  return cls.replace(/[^\w-]/g, ch => `\\${ch}`)
}
