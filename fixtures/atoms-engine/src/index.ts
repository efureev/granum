/**
 * Игрушечный движок словаря `granum-fixtures/atoms@1`.
 *
 * Он здесь не ради демонстрации. Пока единственная реализация `GranumEngine`
 * живёт в нашем же репозитории рядом с ядром, утверждение «движок сменный»
 * ничем не подтверждено: интерфейс мог незаметно опираться на детали
 * `@feugene/granum-engine-mini`. Этот пакет реализует контракт с нуля, на
 * публичных хелперах ядра и без единой строчки UnoCSS, — и на нём собирается
 * фикстура `@granum-fixtures/atoms` и приложение `app-atoms`.
 *
 * Словарь маленький и нарочно не похож на preset-mini: ни одно имя не
 * пересекается, поэтому расхождение диалектов видно сразу — классы `atom-*` у
 * чужого движка просто не имеют правил.
 */
import type { EngineInput, EngineMatch, EngineOutput, GranumEngine, GranumPreflight, GranumRule, GranumVariant } from '@feugene/granum/engine'
import { extractClasses, vocabularyFingerprint } from '@feugene/granum/engine'

/** Имя словаря: по нему granum решает, грузить ли правила пакета (E-1). */
export const ATOMS_DIALECT = 'granum-fixtures/atoms@1'

/** Шаг шкалы `atom-gap-<n>` и `atom-pad-<n>` в пикселях. */
const STEP = 4

/** Встроенный словарь: шесть имён, из них два с числовой шкалой и одно с произвольным значением. */
const BUILTIN_RULES: readonly GranumRule[] = [
  ['atom-stack', { display: 'flex', 'flex-direction': 'column' }],
  ['atom-inline', { display: 'flex', 'flex-direction': 'row', 'align-items': 'center' }],
  ['atom-fill', { flex: '1 1 0%' }],
  [/^atom-gap-(\d+)$/, match => ({ gap: `${Number(match[1]) * STEP}px` })],
  [/^atom-pad-(\d+)$/, match => ({ padding: `${Number(match[1]) * STEP}px` })],
  [/^atom-bg-\[(.+)\]$/, match => ({ background: match[1] })],
]

export interface AtomsEngineOptions {
  /** Правила пакета или приложения поверх встроенных: тот же диалект, другой отпечаток (E-4). */
  readonly rules?: readonly GranumRule[]
  readonly variants?: readonly GranumVariant[]
  readonly preflights?: readonly GranumPreflight[]
}

/** Экранирование селектора: `.atom-bg-[var(--at-bg)]` → `.atom-bg-\[var\(--at-bg\)\]`. */
function escapeSelector(className: string): string {
  return className.replace(/[^\w-]/g, ch => `\\${ch}`)
}

function declarationsOf(rule: GranumRule, className: string): string | undefined {
  const matcher = rule[0]
  if (typeof matcher === 'string')
    return matcher === className ? serialize(rule[1] as Record<string, string>) : undefined
  const match = matcher.exec(className)
  if (!match)
    return undefined
  const handler = rule[1] as (m: RegExpMatchArray, context: unknown) => unknown
  const produced = handler(match, { rawSelector: className, currentSelector: className, theme: {}, generator: undefined, symbols: {} })
  return produced === undefined ? undefined : serialize(produced as Record<string, string>)
}

function serialize(declarations: Record<string, string>): string {
  return Object.entries(declarations).map(([property, value]) => `${property}:${value};`).join('')
}

/**
 * Инстанс движка. `vocabulary` считается хелпером ядра по фактическому набору
 * правил, включая переданные фабрике: приложение с лишним правилом знает больше
 * имён, чем знала сборка пакета, и granum обязан это заметить (E-4, E-6).
 */
export function atomsEngine(options: AtomsEngineOptions = {}): GranumEngine {
  const rules: readonly GranumRule[] = [...BUILTIN_RULES, ...(options.rules ?? [])]
  return {
    name: 'granum-fixtures-atoms-engine',
    version: '0.1.0',
    dialect: ATOMS_DIALECT,
    vocabulary: vocabularyFingerprint({ rules, ...(options.variants ? { variants: options.variants } : {}) }),
    extract: extractClasses,
    async generate(input: EngineInput): Promise<EngineOutput> {
      // Правила провайдеров приходят с входом; они добавляются ПОСЛЕ
      // встроенных и после фабричных, и при совпадении матчеров побеждает
      // последнее совпавшее (INV-ENG-3).
      const all: readonly GranumRule[] = [...rules, ...(input.rules ?? [])]
      const matched = new Map<string, EngineMatch>()
      const unmatched: string[] = []
      const blocks: string[] = []
      for (const className of [...new Set(input.classes)].sort()) {
        let hit: { rule: GranumRule, declarations: string } | undefined
        for (const rule of all) {
          const declarations = declarationsOf(rule, className)
          if (declarations !== undefined)
            hit = { rule, declarations }
        }
        if (!hit) {
          unmatched.push(className)
          continue
        }
        const selector = `.${escapeSelector(className)}`
        const matcher = hit.rule[0]
        matched.set(className, {
          rule: typeof matcher === 'string' ? matcher : matcher.source,
          selector,
          source: input.sources?.get(hit.rule) ?? 'builtin',
          layer: 'default',
        })
        blocks.push(`${selector}{${hit.declarations}}`)
      }
      const preflights = (options.preflights ?? []).concat(input.preflights ?? [])
      const preflightCss = preflights
        .map(p => (typeof p.css === 'function' ? p.css({ theme: {}, generator: undefined }) : p.css))
        .filter((css): css is string => typeof css === 'string' && css.length > 0)
      return { css: [...preflightCss, ...blocks].join('\n'), matched, unmatched }
    },
  }
}
