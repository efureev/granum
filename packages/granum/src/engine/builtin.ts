/**
 * Встроенный движок (E-4): вендоренное ядро UnoCSS + preset-mini + доп-правила.
 * Генератор создаётся на набор (правила, варианты, preflights, тема) и
 * переиспользуется, пока эти ссылки не меняются; классы на входе сортируются,
 * поэтому вывод не зависит от порядка (INV-ENG-1, INV-DET-2).
 */
import type { CreateEngineOptions, EngineInput, EngineMatch, EngineOutput, GranumEngine, GranumPreflight, GranumRule, GranumVariant } from './types'
import type { Preflight, Rule, UnoGenerator, Variant } from './vendor/core/index.js'
import { extractClasses } from './extract'
import { builtinExtraPreflights, builtinExtraRules, builtinExtraVariants } from './rules/index'
import { createGenerator } from './vendor/core/index.js'
import { presetMini } from './vendor/preset-mini/index.js'

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

export function createEngine(options: CreateEngineOptions = {}): GranumEngine {
  let last: { key: CacheKey, prepared: Promise<Prepared> } | undefined

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
    name: 'builtin',
    extract: extractClasses,
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

async function buildGenerator(options: CreateEngineOptions, input: EngineInput): Promise<Prepared> {
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

  const variants: Variant<any>[] = [
    ...(extra ? builtinExtraVariants : []),
    ...((input.variants ?? []) as unknown as readonly Variant<any>[]),
  ]
  const preflights: Preflight<any>[] = [
    ...(extra ? builtinExtraPreflights : []),
    ...(input.preflights ?? []).map(toPreflight),
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

export type { GranumRule, GranumVariant }
