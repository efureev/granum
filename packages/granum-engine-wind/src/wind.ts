/**
 * Движок `@feugene/granum-engine-wind` (E-8): вендоренное ядро UnoCSS +
 * preset-wind3 + одно доп-правило. Генератор создаётся на набор (правила,
 * варианты, preflights, тема) и переиспользуется, пока эти ссылки не меняются;
 * классы на входе сортируются, поэтому вывод не зависит от порядка
 * (INV-ENG-1, INV-DET-2).
 *
 * Почему wind3, а не preset-mini. preset-mini — подмножество Tailwind, и в нём
 * нет `border-collapse`, `list-none`, `touch-none`, `scroll-p*`: класс в разметке
 * есть, правила нет, компонент рисуется не полностью, ошибки при этом никакой.
 * wind3 — это тот же preset-mini плюс wind-правила, поэтому словарь шире, а
 * декларации совпадают: на реальном наборе классов дизайн-системы из 1399 имён
 * расходятся одиннадцать, и все одиннадцать разобраны в CHANGELOG.
 *
 * Диалект и отпечаток словаря — два разных обещания (E-1, E-4). Диалект
 * называет словарь: доп-правило добавляет к wind3 альфу на произвольном цвете,
 * поэтому с ним и без него это разные словари. Отпечаток считается по
 * фактическому набору правил, включая переданные приложением: приложение с
 * собственным правилом знает больше имён, чем знала сборка пакета, и списку
 * классов её манифеста верить уже нельзя.
 *
 * Preflight отдаётся отдельным полем (E-15): инициализация `--un-*` на `*` — это
 * CSS базового уровня, и в слое утилит ему не место. Куда он уедет, движок не
 * знает и знать не должен (E-13).
 */
import type { EngineInput, EngineMatch, EngineOutput, GranumEngine, GranumPreflight, GranumRule, GranumVariant } from '@feugene/granum/engine'
import type { Preflight, Rule, UnoGenerator, Variant } from './vendor/core/index.js'
import { vocabularyFingerprint } from '@feugene/granum/engine'
import { extractWindClasses } from './extract'
import { builtinExtraRules } from './rules/index'
import { createGenerator } from './vendor/core/index.js'
import { presetWind3 } from './vendor/preset-wind3/index.js'

/** Словарь preset-wind3 с нашим доп-правилом. */
export const WIND_DIALECT_EXTRA = 'unocss/preset-wind3+granum@66'
/** Словарь чистого preset-wind3, без доп-правил. */
export const WIND_DIALECT_BASE = 'unocss/preset-wind3@66'
/** Версия вендоренного апстрима; в решениях не участвует (E-5). */
export const WIND_UPSTREAM_VERSION = '66.7.5'

export interface WindEngineOptions {
  /** Preflight встроенного пресета (`*,::before,::after{--un-rotate:0;…}`). По умолчанию `true`. */
  readonly preflight?: boolean
  /** Префикс кастомных свойств встроенных правил (`--un-` по умолчанию). */
  readonly variablePrefix?: string
  /** Подключать ли дополнительные правила поверх preset-wind3 (E-2). По умолчанию `true`. */
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

/**
 * Слои вывода ядра, которые для granum — CSS базового уровня (E-15).
 *
 * `preflights` — инициализация `--un-*` на `*` и `::backdrop`; без неё утилиты,
 * читающие эти переменные (`filter`, `transform`, `ring`), дают невалидные
 * значения. `properties` — регистрации `@property`. И то и другое обязано
 * действовать до стилей компонентов, поэтому уезжает не в утилиты.
 */
const BASE_LAYERS = ['preflights', 'properties']

export function windEngine(options: WindEngineOptions = {}): GranumEngine {
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
    name: 'granum-engine-wind',
    version: WIND_UPSTREAM_VERSION,
    dialect: extra ? WIND_DIALECT_EXTRA : WIND_DIALECT_BASE,
    vocabulary: windVocabulary(options),
    extract: extractWindClasses,
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

      // Вывод делится по слоям ядра, а не текстом: имена слоёв знает ядро, и
      // список `BASE_LAYERS` — единственное место, где он фиксирован.
      const preflight = result.getLayers(BASE_LAYERS).trim()
      const output: EngineOutput = {
        css: result.getLayers(undefined, BASE_LAYERS),
        ...(preflight ? { preflight } : {}),
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

async function buildGenerator(options: WindEngineOptions, input: EngineInput): Promise<Prepared> {
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
    ...((input.variants ?? []) as unknown as readonly Variant<any>[]),
    ...((options.variants ?? []) as unknown as readonly Variant<any>[]),
  ]
  const preflights: Preflight<any>[] = [
    ...(input.preflights ?? []).map(toPreflight),
    ...(options.preflights ?? []).map(toPreflight),
  ]

  const uno = await createGenerator({
    presets: [presetWind3({
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
 * Отпечаток словаря движка (E-4): правила и варианты пресета, доп-правило и
 * правила из фабрики. Опции `preflight` и `variablePrefix` в него не входят —
 * они меняют вывод, а не множество имён.
 *
 * `presetWind3()` здесь вызывается ради одного списка матчеров и не переиспользует
 * инстанс генератора: ядро пишет `meta.__index` прямо в правило, и общий пресет
 * между двумя генераторами получил бы чужой индекс.
 */
function windVocabulary(options: WindEngineOptions): string {
  const preset = presetWind3({})
  const rules = [
    ...((preset.rules ?? []) as unknown as readonly GranumRule[]),
    ...(options.extraRules !== false ? (builtinExtraRules as unknown as readonly GranumRule[]) : []),
    ...(options.rules ?? []),
  ]
  const variants = [
    ...((preset.variants ?? []) as unknown as readonly GranumVariant[]),
    ...(options.variants ?? []),
  ]
  return vocabularyFingerprint({ rules, variants })
}

export type { GranumRule, GranumVariant }
