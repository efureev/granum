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

/**
 * Тело слоя `@layer granum.<layer> { … }`. Скобки считаются вручную, потому что
 * CSS здесь минифицирован и слой — не строка, а блок произвольной вложенности
 * (внутри бывают `@media`).
 */
export function cssLayerBody(css, layer) {
  const marker = new RegExp(`@layer\\s+granum\\.${layer}\\s*\\{`, 'g')
  const parts = []
  for (const m of css.matchAll(marker)) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < css.length && depth > 0) {
      const ch = css[i]
      if (ch === '{')
        depth++
      else if (ch === '}')
        depth--
      i++
    }
    parts.push(css.slice(start, i - 1))
  }
  return parts.join('\n')
}

/**
 * Классы, объявленные в CSS. Читаются только преамбулы правил, а не значения:
 * иначе `padding:1.5rem` даёт «класс» `5rem`.
 *
 * Берётся субъект правила — правый compound. В `.dark .xh-panel__title`
 * правило объявляет `xh-panel__title`, а `.dark` — область темы; считать её
 * классом дистрибутива — всё равно что требовать доказательства от темы. По той же
 * причине из счёта выпадают маркеры вариантов (`.group:hover .group-hover\:flex`).
 *
 * Экранирование снимается ПОСЛЕ разбора имени: снятое заранее, оно обрезало бы
 * `.bg-\[var\(--x\)\]` до `bg-`, потому что `[` — конец имени, а `\[` — нет.
 */
export function cssClassesOf(css) {
  const out = new Set()
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const rule of source.matchAll(/([^{}]*)\{/g)) {
    const prelude = rule[1]
    if (prelude.trim().startsWith('@'))
      continue
    for (const selector of prelude.split(',')) {
      const subject = selector.trim().split(/[\s>+~]+/).pop() ?? ''
      for (const m of subject.matchAll(/\.((?:\\.|[\w-])+)/g))
        out.add(m[1].replace(/\\(.)/g, '$1'))
    }
  }
  return out
}

/** Целые токены текста, разделённые пробелами. Корпус JS передаётся уже без кавычек. */
export function whitespaceTokens(text) {
  return new Set(text.split(/\s+/).filter(Boolean))
}

/** Классы из атрибутов `class="…"` разметки. */
export function htmlClassTokens(html) {
  const out = new Set()
  for (const m of html.matchAll(/class\s*=\s*["']([^"']*)["']/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (token)
        out.add(token)
    }
  }
  return out
}

/**
 * Лестница доказательств использования класса — по убыванию силы.
 *
 * Доказательством считается ТОЛЬКО целый токен. `js-fragment` (в бандле нашёлся
 * лишь литерал-префикс `"p-"`, из которого класс собирают конкатенацией)
 * доказательством не является: двухсимвольный префикс обелил бы вообще всё.
 *
 * Колонка переехала из бюджета пресета v1, но делит классы точнее: «структурный»
 * здесь — объявленный в слое `granum.components`, а не угаданный по имени ассета.
 */
export function classifyClassEvidence(klass, { htmlClasses, jsTokens, jsText, structuralClasses }) {
  const evidence = []
  if (htmlClasses.has(klass))
    evidence.push('html')
  if (jsTokens.has(klass))
    evidence.push('js-literal')
  if (structuralClasses.has(klass))
    evidence.push('component-css')

  if (evidence.length === 0) {
    const dash = klass.lastIndexOf('-')
    if (dash > 0 && jsText.includes(klass.slice(0, dash + 1)))
      evidence.push('js-fragment')
  }

  return { evidence, proven: evidence.includes('html') || evidence.includes('js-literal') }
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
  if (expected.classes?.unproven !== undefined) {
    // Список, а не потолок: новый недоказанный класс надо объяснить, а
    // исчезновение ожидаемого — такое же расхождение (сверка идёт в обе стороны).
    push('classes.unproven', same(expected.classes.unproven, report.classes.unproven), report.classes.unproven, expected.classes.unproven)
  }
  if (expected.granum && report.granum) {
    push('granum.unmatched', same(expected.granum.unmatched ?? [], report.granum.unmatched), report.granum.unmatched, expected.granum.unmatched ?? [])
    push('granum.undefinedTokens', same(expected.granum.undefinedTokens ?? [], report.granum.undefinedTokens), report.granum.undefinedTokens, expected.granum.undefinedTokens ?? [])
    push('granum.pruneMode', report.granum.prune.mode === (expected.granum.pruneMode ?? 'off'), report.granum.prune.mode, expected.granum.pruneMode ?? 'off')
    if (expected.granum.noEngineInBundle)
      // INV-ENG-6: сигнатур генератора в клиентском бандле нет.
      push('granum.noEngineInBundle', !report.engineInBundle, report.engineInBundle, false)
  }
  return checks
}
