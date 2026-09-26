/**
 * Движок для тестов ядра. Ядро реализации движка не содержит (INV-ENG-9), а
 * тянуть в свои юниты `@feugene/granum-engine-mini` значило бы проверять ядро
 * через чужой пакет и зависеть от порядка сборки. Поэтому здесь минимальная
 * реализация `GranumEngine`: она держит ровно те имена, которые встречаются в
 * фикстурах тестов, и повторяет форму вывода настоящего движка
 * (`.sel{decl;}` без `@layer`, объединение `matched` и `unmatched` равно входу).
 *
 * Заодно это проверка контракта на практике: если ядро начнёт опираться на
 * что-то, кроме `GranumEngine`, тесты перестанут собираться.
 */
import type { EngineInput, EngineMatch, EngineOutput, GranumEngine, GranumRule } from '../engine/types'
import { extractClasses } from '../engine/extract'
import { vocabularyFingerprint } from '../engine/fingerprint'

/** Именованные утилиты: значения совпадают с preset-mini, чтобы ожидания тестов читались как настоящие. */
const STATIC: Readonly<Record<string, string>> = {
  'flex': 'display:flex;',
  'block': 'display:block;',
  'w-full': 'width:100%;',
  'h-full': 'height:100%;',
  'uppercase': 'text-transform:uppercase;',
  'sr-only': 'position:absolute;width:1px;height:1px;overflow:hidden;',
  'text-lg': 'font-size:1.125rem;line-height:1.75rem;',
  'font-bold': 'font-weight:700;',
  'italic': 'font-style:italic;',
  'rounded': 'border-radius:0.25rem;',
  'border': 'border-width:1px;',
}

/** Свойство по префиксу числовой и произвольной шкалы. */
const PROPERTY: Readonly<Record<string, string>> = {
  p: 'padding',
  px: 'padding-inline',
  py: 'padding-block',
  pt: 'padding-top',
  pb: 'padding-bottom',
  m: 'margin',
  mx: 'margin-inline',
  my: 'margin-block',
  gap: 'gap',
  w: 'width',
  h: 'height',
  z: 'z-index',
  top: 'top',
  bg: 'background-color',
  text: 'color',
  rounded: 'border-radius',
  border: 'border-color',
  shadow: 'box-shadow',
  tracking: 'letter-spacing',
}

/** Шкалы без единиц: `z-10`, а не `z-2.5rem`. */
const UNITLESS = new Set(['z'])
/** Шкалы, у которых числовой формы нет: `bg-4` смысла не имеет, `bg-[…]` — имеет. */
const ARBITRARY_ONLY = new Set(['bg', 'text', 'border', 'shadow', 'tracking'])

const ARBITRARY_RE = /^([a-z]+)-\[(.+)\]$/
const NUMERIC_RE = /^([a-z]+)-(\d+(?:\.\d+)?)$/
const AUTO_RE = /^([a-z]+)-auto$/
const VARIANT_RE = /^(hover|focus|odd|even|dark):(.+)$/

const VARIANT_SUFFIX: Readonly<Record<string, string>> = {
  hover: ':hover',
  focus: ':focus',
  odd: ':nth-child(odd)',
  even: ':nth-child(even)',
  dark: '',
}

/** Словарь движка тестов: провайдеры фикстур объявляют его, когда привозят правила. */
export const TEST_DIALECT = 'granum-tests/mini@1'

export interface TestEngineOptions {
  readonly dialect?: string
  readonly vocabulary?: string
  readonly name?: string
  readonly version?: string
  /** Имена, которые движок знает сверх встроенного набора: значение — декларации. */
  readonly extra?: Readonly<Record<string, string>>
}

/** Экранирование селектора как в движке: `.gap-[var(--x)]` → `.gap-\[var\(--x\)\]`. */
function escapeSelector(className: string): string {
  return className.replace(/[^\w-]/g, ch => `\\${ch}`)
}

function declarationsOf(className: string, options: TestEngineOptions, inputRules: readonly GranumRule[]): string | undefined {
  const extra = options.extra?.[className]
  if (extra !== undefined)
    return extra
  for (const rule of inputRules) {
    if (typeof rule[0] === 'string' && rule[0] === className)
      return declarationsFromRule(rule)
  }
  const named = STATIC[className]
  if (named !== undefined)
    return named
  const arbitrary = ARBITRARY_RE.exec(className)
  if (arbitrary) {
    const property = PROPERTY[arbitrary[1]!]
    return property === undefined ? undefined : `${property}:${arbitrary[2]!};`
  }
  const auto = AUTO_RE.exec(className)
  if (auto) {
    const property = PROPERTY[auto[1]!]
    return property === undefined || ARBITRARY_ONLY.has(auto[1]!) ? undefined : `${property}:auto;`
  }
  const numeric = NUMERIC_RE.exec(className)
  if (numeric) {
    const prefix = numeric[1]!
    const property = PROPERTY[prefix]
    if (property === undefined || ARBITRARY_ONLY.has(prefix))
      return undefined
    const value = Number(numeric[2])
    return `${property}:${UNITLESS.has(prefix) ? value : `${value / 4}rem`};`
  }
  return undefined
}

/** Декларации статического правила контракта: объект или массив пар. */
function declarationsFromRule(rule: GranumRule): string {
  const body = rule[1] as unknown
  const entries = Array.isArray(body) ? (body as readonly (readonly [string, unknown])[]) : Object.entries(body as object)
  return entries.map(([property, value]) => `${property}:${String(value)};`).join('')
}

/**
 * Минимальный движок: статические имена, числовые и произвольные шкалы, четыре
 * варианта. Статические правила из `input.rules` поддерживаются — на них
 * опираются тесты вклада провайдеров; динамические (RegExp) не исполняются,
 * потому что ни один тест ядра их не требует.
 */
export function testEngine(options: TestEngineOptions = {}): GranumEngine {
  const known = [...Object.keys(STATIC), ...Object.keys(PROPERTY), ...Object.keys(options.extra ?? {})]
  return {
    name: options.name ?? 'test-engine',
    ...(options.version !== undefined ? { version: options.version } : {}),
    dialect: options.dialect ?? TEST_DIALECT,
    vocabulary: options.vocabulary ?? vocabularyFingerprint({ rules: known.map(name => [name, {}] as GranumRule) }),
    extract: extractClasses,
    async generate(input: EngineInput): Promise<EngineOutput> {
      const classes = [...new Set(input.classes)].sort()
      const rules = input.rules ?? []
      const matched = new Map<string, EngineMatch>()
      const unmatched: string[] = []
      const blocks: string[] = []
      for (const className of classes) {
        const variant = VARIANT_RE.exec(className)
        const base = variant ? variant[2]! : className
        const declarations = declarationsOf(base, options, rules)
        if (declarations === undefined) {
          unmatched.push(className)
          continue
        }
        const selector = `.${escapeSelector(className)}${variant ? VARIANT_SUFFIX[variant[1]!] : ''}`
        const rule = rules.find(r => typeof r[0] === 'string' && r[0] === base)
        matched.set(className, {
          rule: base,
          selector,
          source: (rule && input.sources?.get(rule)) ?? 'builtin',
          layer: 'default',
        })
        blocks.push(`${selector}{${declarations}}`)
      }
      return { css: blocks.join('\n'), matched, unmatched }
    },
  }
}
