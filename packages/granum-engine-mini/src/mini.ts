/**
 * Движок `@feugene/granum-engine-mini` (E-8): вендоренное ядро UnoCSS +
 * preset-mini + доп-правила. Генератор создаётся на набор (правила, варианты,
 * preflights, тема) и переиспользуется, пока эти ссылки не меняются; классы на
 * входе сортируются, поэтому вывод не зависит от порядка (INV-ENG-1, INV-DET-2).
 *
 * Диалект и отпечаток словаря — два разных обещания (E-1, E-4). Диалект
 * называет словарь: доп-правила добавляют к preset-mini `divide-y`, `space-x-4`
 * и `tabular-nums`, поэтому с ними и без них это разные словари. Отпечаток
 * считается по фактическому набору правил, включая переданные приложением:
 * приложение с собственным правилом знает больше имён, чем знала сборка
 * пакета, и списку классов её манифеста верить уже нельзя.
 */
import type { EngineInput, EngineMatch, EngineOutput, GranumEngine, GranumPreflight, GranumRule, GranumVariant } from '@feugene/granum/engine'
import type { Preflight, Rule, UnoGenerator, Variant } from './vendor/core/index.js'
import { vocabularyFingerprint } from '@feugene/granum/engine'
import { extractMiniClasses } from './extract'
import { builtinExtraPreflights, builtinExtraRules, builtinExtraVariants } from './rules/index'
import { createGenerator } from './vendor/core/index.js'
import { presetMini } from './vendor/preset-mini/index.js'

/** Словарь preset-mini с нашими доп-правилами. */
export const MINI_DIALECT_EXTRA = 'unocss/preset-mini+granum@66'
/** Словарь чистого preset-mini, без доп-правил. */
export const MINI_DIALECT_BASE = 'unocss/preset-mini@66'
/** Версия вендоренного апстрима; в решениях не участвует (E-5). */
export const MINI_UPSTREAM_VERSION = '66.7.5'

export interface MiniEngineOptions {
  /** Preflight встроенного пресета (`*,::before,::after{--un-rotate:0;…}`). По умолчанию `true`. */
  readonly preflight?: boolean
  /** Префикс кастомных свойств встроенных правил (`--un-` по умолчанию). */
  readonly variablePrefix?: string
  /** Подключать ли дополнительные правила поверх preset-mini (E-2). По умолчанию `true`. */
  readonly extraRules?: boolean
  /** Правила приложения: тот же диалект, другой отпечаток (E-10, E-4). */
  readonly rules?: readonly GranumRule[]
  readonly variants?: readonly GranumVariant[]
  readonly preflights?: readonly GranumPreflight[]
}

interface Prepared {
  readonly uno: UnoGenerator<any>
  readonly sourceOf: WeakMap<object, string>
}

type CacheKey = readonly [
  EngineInput['rules'],
  EngineInput['variants'],
  EngineInput['preflights'],
  EngineInput['theme'],
  EngineInput['sources'],
]

/** Сколько последних множеств классов помнить на генератор. */
const OUTPUT_CACHE_SIZE = 8

export function miniEngine(options: MiniEngineOptions = {}): GranumEngine {
  let last: { key: CacheKey, prepared: Promise<Prepared> } | undefined
  const extra = options.extraRules !== false

  const prepare = (input: EngineInput): Promise<Prepared> => {
    const key: CacheKey = [input.rules, input.variants, input.preflights, input.theme, input.sources]
    if (last && key.every((value, i) => value === last!.key[i]))
      return last.prepared
    const prepared = buildGenerator(options, input)
    last = { key, prepared }
    return prepared
  }

  const outputs = new WeakMap<object, Map<string, EngineOutput>>()
  return {
    name: 'granum-engine-mini',
    version: MINI_UPSTREAM_VERSION,
    dialect: extra ? MINI_DIALECT_EXTRA : MINI_DIALECT_BASE,
    vocabulary: miniVocabulary(options),
    extract: extractMiniClasses,
    async generate(input: EngineInput): Promise<EngineOutput> {
      const { uno, sourceOf } = await prepare(input)
      const classes = [...new Set(input.classes)].sort()
      // Кэш результата по генератору и множеству классов (A-17): в dev каждая
      // правка исходников приложения заново собирает тот же вход из манифестов.
      const key = classes.join(' ')
      const cached = outputs.get(uno)?.get(key)
      if (cached)
        return cached
      const result = await uno.generate(new Set(classes), { preflights: true, safelist: false, minify: false })

      const matched = new Map<string, EngineMatch>()
      for (const token of classes) {
        if (!result.matched.has(token))
          continue
        const utils = await uno.parseToken(token)
        const first = utils?.[0]
        if (!first)
          continue
        const [index, selector, , , meta] = first
        const rule = uno.config.rules[index] as Rule<any> | undefined
        matched.set(token, {
          rule: rule ? ruleLabel(rule) : String(index),
          selector: selector ?? token,
          source: (rule && sourceOf.get(rule)) ?? 'builtin',
          layer: meta?.layer ?? 'default',
        })
      }

      const output: EngineOutput = {
        css: result.css,
        matched,
        unmatched: classes.filter(c => !matched.has(c)),
      }
      let byKey = outputs.get(uno)
      if (!byKey) {
        byKey = new Map()
        outputs.set(uno, byKey)
      }
      if (byKey.size >= OUTPUT_CACHE_SIZE)
        byKey.delete(byKey.keys().next().value!)
      byKey.set(key, output)
      return output
    },
  }
}

async function buildGenerator(options: MiniEngineOptions, input: EngineInput): Promise<Prepared> {
  const extra = options.extraRules !== false
  const sourceOf = new WeakMap<object, string>()
  const rules: Rule<any>[] = []

  // Копии кортежей, а не сами: ядро пишет `meta.__index` и `meta.layer` прямо
  // в правило, и общий инстанс между двумя генераторами получил бы чужой индекс.
  // При этом `meta`, разделяемая несколькими правилами (так объявлено семейство
  // `*-nums`), остаётся разделяемой ВНУТРИ генератора: от этого зависит порядок
  // эмиссии, и он обязан совпадать с эталоном (INV-ENG-4).
  const metaClones = new Map<object, object>()
  const tag = (rule: Rule<any>, source: string): void => {
    const copy = cloneRule(rule, metaClones)
    sourceOf.set(copy, source)
    rules.push(copy)
  }
  if (extra) {
    for (const rule of builtinExtraRules)
      tag(rule, 'builtin')
  }
  for (const rule of input.rules ?? [])
    tag(rule as unknown as Rule<any>, input.sources?.get(rule) ?? 'app')
  // Правила из фабрики — последние: приложение перекрывает и встроенное, и
  // правила провайдеров (INV-ENG-3).
  for (const rule of options.rules ?? [])
    tag(rule as unknown as Rule<any>, 'app')

  const variants: Variant<any>[] = [
    ...(extra ? builtinExtraVariants : []),
    ...((input.variants ?? []) as unknown as readonly Variant<any>[]),
    ...((options.variants ?? []) as unknown as readonly Variant<any>[]),
  ]
  const preflights: Preflight<any>[] = [
    ...(extra ? builtinExtraPreflights : []),
    ...(input.preflights ?? []).map(toPreflight),
    ...(options.preflights ?? []).map(toPreflight),
  ]

  const uno = await createGenerator({
    presets: [presetMini({
      preflight: options.preflight ?? true,
      ...(options.variablePrefix !== undefined ? { variablePrefix: options.variablePrefix } : {}),
    })],
    rules,
    variants,
    preflights,
    theme: (input.theme ?? {}) as Record<string, unknown>,
  })

  return { uno, sourceOf }
}

function cloneRule(rule: Rule<any>, metaClones: Map<object, object>): Rule<any> {
  const copy = [...(rule as unknown as unknown[])]
  const meta = copy[2]
  if (meta && typeof meta === 'object') {
    let cloned = metaClones.get(meta)
    if (!cloned) {
      cloned = { ...(meta as Record<string, unknown>) }
      metaClones.set(meta, cloned)
    }
    copy[2] = cloned
  }
  return copy as unknown as Rule<any>
}

function ruleLabel(rule: Rule<any>): string {
  const matcher = rule[0]
  return typeof matcher === 'string' ? matcher : matcher.source
}

function toPreflight(preflight: GranumPreflight): Preflight<any> {
  return {
    getCSS: ctx => typeof preflight.css === 'function'
      ? preflight.css({ theme: ctx.theme as Record<string, unknown>, generator: ctx.generator })
      : preflight.css,
    ...(preflight.layer !== undefined ? { layer: preflight.layer } : {}),
  }
}

/**
 * Отпечаток словаря движка (E-4): правила и варианты пресета, доп-правила и
 * правила из фабрики. Опции `preflight` и `variablePrefix` в него не входят —
 * они меняют вывод, а не множество имён.
 *
 * `presetMini()` здесь вызывается ради одного списка матчеров и не переиспользует
 * инстанс генератора: ядро пишет `meta.__index` прямо в правило, и общий пресет
 * между двумя генераторами получил бы чужой индекс.
 */
function miniVocabulary(options: MiniEngineOptions): string {
  const preset = presetMini({})
  const rules = [
    ...((preset.rules ?? []) as unknown as readonly GranumRule[]),
    ...(options.extraRules !== false ? (builtinExtraRules as unknown as readonly GranumRule[]) : []),
    ...(options.rules ?? []),
  ]
  const variants = [
    ...((preset.variants ?? []) as unknown as readonly GranumVariant[]),
    ...(options.extraRules !== false ? (builtinExtraVariants as unknown as readonly GranumVariant[]) : []),
    ...(options.variants ?? []),
  ]
  return vocabularyFingerprint({ rules, variants })
}

export type { GranumRule, GranumVariant }
