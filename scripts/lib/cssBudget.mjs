/**
 * Чистые функции измерителя бюджета CSS/JS стендов (N-4, N-5). Ни одного
 * обращения к FS: ввод — текст, вывод — данные. I/O и печать живут в
 * `report-css-budget.mjs`.
 */

/** Роли ассетов; список упорядочен, первое совпадение выигрывает. Неопознанный ассет роняет отчёт. */
export const ASSET_ROLES = [
  { role: 'vue', test: /^vue-.*\.js$/ },
  { role: 'pkg', test: /^hpkg-.*\.(?:js|css)$/ },
  { role: 'css', test: /^index-.*\.css$/ },
  { role: 'entry', test: /^index-.*\.js$/ },
]

export function classifyAsset(fileName) {
  return ASSET_ROLES.find(rule => rule.test.test(fileName))?.role
}

/** Объявленные в CSS кастом-проперти (без `--`), включая блоки внутри at-rules. */
export function declaredTokens(css) {
  const out = new Set()
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of source.matchAll(/(?<=[{;\s])--([\w-]+)\s*:/g))
    out.add(m[1])
  return out
}

/** Токены, на которые ссылаются: `var(--x)` в CSS и JS, литералы `--x` в JS. Значения объявлений тоже считаются (граф «токен → токены в его значении»). */
export function referencedTokens(css, js) {
  const out = new Set()
  for (const m of css.matchAll(/var\(\s*--([\w-]+)/g))
    out.add(m[1])
  for (const m of js.matchAll(/--([a-z][\w-]*)/gi))
    out.add(m[1])
  return out
}

/**
 * Токены, достижимые от корней: корень — ссылка вне значения кастом-проперти
 * (в правилах CSS, в JS), далее — по значениям объявлений.
 */
export function reachableTokens(css, js) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const valueRefs = new Map()
  let stripped = source
  for (const m of source.matchAll(/(?<=[{;\s])--([\w-]+)\s*:([^;}]*)/g)) {
    const refs = [...m[2].matchAll(/var\(\s*--([\w-]+)/g)].map(r => r[1])
    valueRefs.set(m[1], [...(valueRefs.get(m[1]) ?? []), ...refs])
    stripped = stripped.replace(m[0], '')
  }
  const reachable = new Set(referencedTokens(stripped, js))
  const queue = [...reachable]
  while (queue.length) {
    const token = queue.pop()
    for (const ref of valueRefs.get(token) ?? []) {
      if (!reachable.has(ref)) {
        reachable.add(ref)
        queue.push(ref)
      }
    }
  }
  return reachable
}

export function formatBytes(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function formatDelta(n) {
  return n === 0 ? '0' : `${n > 0 ? '+' : '−'}${formatBytes(Math.abs(n))}`
}

/** Проверка ожиданий `expected-budget.mjs` против отчёта — в обе стороны. */
export function strictCheck(expected, report) {
  const checks = []
  const push = (name, ok, actual, want) => checks.push({ name, ok, actual, want })
  const same = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort())
  if (expected.assets?.roles)
    push('assets.roles', same(expected.assets.roles, Object.keys(report.roles)), Object.keys(report.roles), expected.assets.roles)
  if (expected.report === false)
    push('report.absent', report.granum === null, report.granum === null, true)
  if (expected.tokens) {
    if (expected.tokens.maxUnused !== undefined)
      push('tokens.maxUnused', report.tokens.unused.length <= expected.tokens.maxUnused, report.tokens.unused.length, `<= ${expected.tokens.maxUnused}`)
    if (expected.tokens.minDeclared !== undefined)
      push('tokens.minDeclared', report.tokens.declared >= expected.tokens.minDeclared, report.tokens.declared, `>= ${expected.tokens.minDeclared}`)
  }
  if (expected.granum && report.granum) {
    push('granum.unmatched', same(expected.granum.unmatched ?? [], report.granum.unmatched), report.granum.unmatched, expected.granum.unmatched ?? [])
    push('granum.undefinedTokens', same(expected.granum.undefinedTokens ?? [], report.granum.undefinedTokens), report.granum.undefinedTokens, expected.granum.undefinedTokens ?? [])
    push('granum.pruneMode', report.granum.prune.mode === (expected.granum.pruneMode ?? 'off'), report.granum.prune.mode, expected.granum.pruneMode ?? 'off')
    if (expected.granum.noEngineInBundle)
      push('granum.noEngineInBundle', !report.engineInBundle, report.engineInBundle, false)
  }
  return checks
}
