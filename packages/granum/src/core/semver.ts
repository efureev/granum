/**
 * Версии и диапазоны темы (C-41): подмножество node-semver без зависимостей
 * пакета (§4.3). Диапазон раскрывается в наборы компараторов теми же правилами,
 * что у node-semver, — с верхними границами `-0`, которые не пускают предрелизы
 * следующей версии, и правилом предрелиза: версия с ним подходит, только если в
 * наборе есть компаратор с предрелизом того же `MAJOR.MINOR.PATCH`. Эталон —
 * `semver.test.ts` против `semver`.
 */

export interface SemVer {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly (string | number)[]
}

const NUMERIC = '0|[1-9]\\d*'
// Флаг `i`: буквы предрелиза — в любом регистре, `x` позиции — и `X`.
const PRERELEASE_ID = `(?:${NUMERIC}|\\d*[a-z-][\\da-z-]*)`
const PRERELEASE = `(?:-(${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*))?`
const VERSION = new RegExp(`^(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})${PRERELEASE}$`, 'i')
const XR = '[0x*]|[1-9]\\d*'
const PARTIAL = new RegExp(`^(${XR})(?:\\.(${XR})(?:\\.(${XR})${PRERELEASE})?)?$`, 'i')
const COMPARATOR = /^(<=|>=|[<>=~^])?(.*)$/

function parsePrerelease(text: string | undefined): (string | number)[] {
  return text === undefined ? [] : text.split('.').map(id => (/^\d+$/.test(id) ? Number(id) : id))
}

function safeNumbers(...values: (string | undefined)[]): boolean {
  return values.every(value => value === undefined || Number(value) <= Number.MAX_SAFE_INTEGER)
}

/** `MAJOR.MINOR.PATCH[-pre]` без сборочных метаданных; иное — `undefined`. */
export function parseVersion(text: string): SemVer | undefined {
  const match = VERSION.exec(text)
  if (!match || !safeNumbers(match[1], match[2], match[3]))
    return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: parsePrerelease(match[4]) }
}

export function isVersion(text: unknown): text is string {
  return typeof text === 'string' && parseVersion(text) !== undefined
}

function compareIdentifiers(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number')
    return a - b
  if (typeof a === 'number')
    return -1
  if (typeof b === 'number')
    return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Порядок версий по semver: без предрелиза старше, чем с ним. */
export function compareVersions(a: SemVer, b: SemVer): number {
  const main = a.major - b.major || a.minor - b.minor || a.patch - b.patch
  if (main !== 0)
    return main
  if (a.prerelease.length === 0 || b.prerelease.length === 0)
    return b.prerelease.length - a.prerelease.length
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === undefined || y === undefined)
      return x === undefined ? -1 : 1
    const order = compareIdentifiers(x, y)
    if (order !== 0)
      return order
  }
  return 0
}

type Operator = '<' | '<=' | '>' | '>=' | '='

interface Comparator {
  readonly operator: Operator
  readonly version: SemVer
}

/** Пустой набор не подходит никому; набор без компараторов — любой версии. */
type ComparatorSet = readonly Comparator[] | 'none'

interface Partial {
  readonly major?: number
  readonly minor?: number
  readonly patch?: number
  readonly prerelease: readonly (string | number)[]
}

function isWildcard(part: string | undefined): boolean {
  return part === undefined || part === 'x' || part === 'X' || part === '*'
}

function parsePartial(text: string): Partial | undefined {
  const match = PARTIAL.exec(text)
  if (!match)
    return undefined
  const [, major, minor, patch, pre] = match
  // После `x`/`*` чисел не бывает: `1.x.3` и `*.2` — не диапазоны.
  if ((isWildcard(major) && (!isWildcard(minor) || !isWildcard(patch))) || (isWildcard(minor) && !isWildcard(patch)))
    return undefined
  if (!safeNumbers(...[major, minor, patch].filter(part => !isWildcard(part))))
    return undefined
  if (isWildcard(major))
    return { prerelease: [] }
  if (isWildcard(minor))
    return { major: Number(major), prerelease: [] }
  if (isWildcard(patch))
    return { major: Number(major), minor: Number(minor), prerelease: [] }
  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease: parsePrerelease(pre) }
}

function version(major: number, minor: number, patch: number, prerelease: readonly (string | number)[] = []): SemVer {
  return { major, minor, patch, prerelease }
}

/** Граница «до следующей»: `<2.0.0-0` не пускает предрелизы `2.0.0`. */
function below(major: number, minor: number, patch: number): Comparator {
  return { operator: '<', version: version(major, minor, patch, [0]) }
}

function atLeast(major: number, minor: number, patch: number, prerelease: readonly (string | number)[] = []): Comparator {
  return { operator: '>=', version: version(major, minor, patch, prerelease) }
}

function desugarTilde(p: Partial): Comparator[] {
  if (p.major === undefined)
    return []
  if (p.minor === undefined)
    return [atLeast(p.major, 0, 0), below(p.major + 1, 0, 0)]
  return [atLeast(p.major, p.minor, p.patch ?? 0, p.prerelease), below(p.major, p.minor + 1, 0)]
}

function desugarCaret(p: Partial): Comparator[] {
  if (p.major === undefined)
    return []
  if (p.minor === undefined)
    return [atLeast(p.major, 0, 0), below(p.major + 1, 0, 0)]
  if (p.patch === undefined) {
    return p.major === 0
      ? [atLeast(0, p.minor, 0), below(0, p.minor + 1, 0)]
      : [atLeast(p.major, p.minor, 0), below(p.major + 1, 0, 0)]
  }
  const from = atLeast(p.major, p.minor, p.patch, p.prerelease)
  if (p.major !== 0)
    return [from, below(p.major + 1, 0, 0)]
  if (p.minor !== 0)
    return [from, below(0, p.minor + 1, 0)]
  return [from, below(0, 0, p.patch + 1)]
}

function desugarPrimitive(operator: Operator, p: Partial): ComparatorSet {
  if (p.major === undefined)
    return operator === '<' || operator === '>' ? 'none' : []
  if (p.minor === undefined || p.patch === undefined) {
    const minor = p.minor ?? 0
    switch (operator) {
      case '=':
        return p.minor === undefined
          ? [atLeast(p.major, 0, 0), below(p.major + 1, 0, 0)]
          : [atLeast(p.major, minor, 0), below(p.major, minor + 1, 0)]
      case '>=':
        return [atLeast(p.major, minor, 0)]
      case '>':
        return p.minor === undefined ? [atLeast(p.major + 1, 0, 0)] : [atLeast(p.major, minor + 1, 0)]
      case '<':
        return [below(p.major, minor, 0)]
      case '<=':
        return p.minor === undefined ? [below(p.major + 1, 0, 0)] : [below(p.major, minor + 1, 0)]
    }
  }
  return [{ operator, version: version(p.major, p.minor, p.patch, p.prerelease) }]
}

function parseComparator(text: string): ComparatorSet | undefined {
  const [, operator, rest] = COMPARATOR.exec(text)!
  const partial = parsePartial(rest!)
  if (!partial)
    return undefined
  if (operator === '~')
    return desugarTilde(partial)
  if (operator === '^')
    return desugarCaret(partial)
  return desugarPrimitive((operator ?? '=') as Operator, partial)
}

function parseHyphen(from: string, to: string): ComparatorSet | undefined {
  const low = parsePartial(from)
  const high = parsePartial(to)
  if (!low || !high)
    return undefined
  const out: Comparator[] = []
  if (low.major !== undefined)
    out.push(atLeast(low.major, low.minor ?? 0, low.patch ?? 0, low.patch === undefined ? [] : low.prerelease))
  if (high.major !== undefined) {
    if (high.minor === undefined)
      out.push(below(high.major + 1, 0, 0))
    else if (high.patch === undefined)
      out.push(below(high.major, high.minor + 1, 0))
    else
      out.push({ operator: '<=', version: version(high.major, high.minor, high.patch, high.prerelease) })
  }
  return out
}

function parseSet(text: string): ComparatorSet | undefined {
  const trimmed = text.trim()
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed)
  if (hyphen)
    return parseHyphen(hyphen[1]!, hyphen[2]!)
  // Пробел внутри оператора (`> = 1.2.3`) — не оператор.
  if (/[<>]\s+=/.test(trimmed))
    return undefined
  // `>= 1.2.3` — оператор отделён пробелом: склеиваем, иначе это два компаратора.
  const parts = trimmed.replace(/(<=|>=|[<>=~^])\s+/g, '$1').split(/\s+/).filter(Boolean)
  const out: Comparator[] = []
  for (const part of parts) {
    const set = parseComparator(part)
    if (set === undefined)
      return undefined
    if (set === 'none')
      return 'none'
    out.push(...set)
  }
  return out
}

function parseRange(range: string): ComparatorSet[] | undefined {
  const sets: ComparatorSet[] = []
  for (const text of range.split('||')) {
    const set = parseSet(text)
    if (set === undefined)
      return undefined
    sets.push(set)
  }
  return sets
}

export function isValidRange(range: unknown): range is string {
  return typeof range === 'string' && parseRange(range) !== undefined
}

function test(comparator: Comparator, v: SemVer): boolean {
  const order = compareVersions(v, comparator.version)
  switch (comparator.operator) {
    case '<': return order < 0
    case '<=': return order <= 0
    case '>': return order > 0
    case '>=': return order >= 0
    case '=': return order === 0
  }
}

function testSet(set: ComparatorSet, v: SemVer): boolean {
  if (set === 'none')
    return false
  if (!set.every(comparator => test(comparator, v)))
    return false
  if (v.prerelease.length === 0)
    return true
  return set.some(({ version: c }) => c.prerelease.length > 0 && c.major === v.major && c.minor === v.minor && c.patch === v.patch)
}

/**
 * Подходит ли версия под диапазон. Невалидная версия или диапазон — `false`.
 * Сборочные метаданные версии пакета (`2.1.0+sha`) в сравнении не участвуют.
 */
export function satisfies(versionText: string, range: string): boolean {
  const v = parseVersion(versionText.replace(/\+[\w.-]+$/, ''))
  const sets = parseRange(range)
  if (!v || !sets)
    return false
  return sets.some(set => testSet(set, v))
}
