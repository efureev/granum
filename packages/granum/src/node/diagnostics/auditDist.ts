/**
 * Аудит собранного дистрибутива (D-9): что из пакетов доехало, а что обязано
 * было исчезнуть.
 *
 * Самая полезная проверка конвейера — она единственная смотрит не на резолюцию, а
 * на результат: вырезан ли невыбранный компонент целиком, вместе с классами,
 * собственным CSS и токенами. До этого она жила скриптом одного стенда и была
 * приколочена к одной фикстуре: имя пакета, префикс его токенов и путь к `dist`
 * стояли в коде. Здесь всё это выводится из двух источников правды:
 *
 *   - **отчёт сборки** (`granum-report.json`) даёт селекцию и список провайдеров;
 *   - **манифест каждого провайдера** даёт его компоненты с классами, их
 *     собственный CSS и объявленные токены.
 *
 * Поэтому аудит наводится на любое приложение, собранное granum, включая чужой
 * репозиторий: нужен только его `dist`.
 *
 * Чего аудит НЕ делает: не судит о размере (это `sizes`) и не читает исходники
 * приложения. Он отвечает на один вопрос — «есть ли в дистрибутиве то, чего быть
 * не должно, и всё ли есть из того, что должно».
 */
import type { GranumManifest, GranumManifestComponent } from '../../contract/manifest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'

/** Минимум отчёта сборки, который нужен аудиту: остальные поля не читаются. */
interface AuditInputReport {
  readonly selection?: readonly { readonly key: string }[]
  readonly providers?: readonly { readonly id: string, readonly form?: string }[]
  readonly classes?: {
    readonly matched?: number
    readonly input?: number
    readonly unmatched?: readonly { readonly className: string }[]
    /** Классы из разметки самого приложения: они не принадлежат ни одному компоненту. */
    readonly app?: readonly string[]
  }
  readonly tokens?: { readonly undefined?: readonly string[] }
  readonly prune?: { readonly mode: string, readonly removable: readonly unknown[], readonly kept: number, readonly deadPatterns: readonly unknown[] }
  readonly sizes?: Readonly<Record<string, { readonly raw: number, readonly gzip: number }>>
  readonly sizesSource?: string
}

export interface AuditDistOptions {
  /** Каталог собранного приложения. Ищется рекурсивно: `dist/assets`, `dist/client/assets`. */
  readonly dist: string
  /** Корень, из которого резолвятся манифесты провайдеров. По умолчанию — родитель `dist`. */
  readonly root?: string
  /** Имя файла отчёта внутри `dist` (или его подкаталога). По умолчанию `granum-report.json`. */
  readonly reportFile?: string
  /**
   * Префикс переменных движка. Они объявлены одним блоком preflight на весь
   * набор утилит, токенами пакета не являются и обрезке не подлежат — аудит
   * называет их отдельной строкой, а не прячет в находках пакета.
   */
  readonly enginePrefix?: string
  /**
   * Доводить ли находки отчёта сборки (классы без правила, токены без
   * объявления) до кода возврата. По умолчанию нет: это предмет `doctor` и
   * `report --strict`, а у стенда они бывают намеренными.
   */
  readonly strict?: boolean
}

export interface AuditComponentInfo {
  readonly key: string
  readonly providerId: string
  readonly name: string
  readonly selected: boolean
  /** Классы компонента, найденные в JS дистрибутива. */
  readonly classesInJs: number
  /** Классы компонента, найденные селекторами в CSS. */
  readonly classesInCss: number
  readonly classes: number
  /** Селекторы собственного CSS компонента и сколько их доехало. */
  readonly ownSelectors: number
  readonly ownSelectorsInCss: number
}

export interface AuditProviderInfo {
  readonly id: string
  readonly version: string | null
  readonly components: number
  readonly declaredTokens: number
  /** Манифест найден: без него о провайдере ничего не известно. */
  readonly manifest: boolean
}

export interface AuditDistReport {
  readonly dist: string
  readonly assets: { readonly css: readonly string[], readonly js: readonly string[] }
  readonly providers: readonly AuditProviderInfo[]
  readonly selection: readonly string[]
  readonly components: readonly AuditComponentInfo[]
  readonly tokens: {
    /** Объявлено пакетами (по манифестам). */
    readonly declaredByPackages: number
    /** Из них доехало в дистрибутив. */
    readonly inDist: readonly string[]
    /** Из них вырезано обрезкой. */
    readonly cut: readonly string[]
    /** Доехало, но недостижимо ни из CSS, ни из JS — мёртвый груз. */
    readonly dead: readonly string[]
    /** Объявлено в дистрибутиве, но ни одним пакетом и не движком: CSS приложения. */
    readonly foreign: readonly string[]
  }
  readonly engine: { readonly prefix: string, readonly declared: number, readonly used: number }
  /** Включена ли обрезка токенов: без неё недостижимый токен — не находка. */
  readonly pruning: boolean
  /** Выжимка из отчёта сборки: она прочитана всё равно, а сопоставлять два файла руками — лишняя работа. */
  readonly build: {
    readonly classesMatched: number
    readonly classesInput: number
    readonly classesUnmatched: readonly string[]
    readonly tokensUndefined: readonly string[]
    readonly prune?: { readonly mode: string, readonly removed: number, readonly kept: number, readonly deadPatterns: number }
    readonly sizes?: Readonly<Record<string, { readonly raw: number, readonly gzip: number }>>
    readonly sizesSource?: string
  }
  readonly problems: readonly string[]
  /** То, о чём аудит судить отказался, и почему: на код возврата не влияет. */
  readonly notes: readonly string[]
  readonly ok: boolean
}

function walk(dir: string, accept: (name: string) => boolean, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  }
  catch {
    return out
  }
  for (const name of entries.sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory())
      walk(full, accept, out)
    else if (accept(name))
      out.push(full)
  }
  return out
}

/**
 * Классы, объявленные в CSS: `.bg-\\[var\\(--x\\)\\]` → `bg-[var(--x)]`.
 *
 * Читаются только преамбулы правил (всё до `{`), а не значения: иначе
 * `padding:1.5rem` даёт «класс» `5rem`.
 *
 * Сравнение потом идёт точное, а не по подстроке, и это не придирка:
 * `.xh-panel__title` содержит `.xh-panel`, и поиск подстрокой выдавал выпиленное
 * правило за живое — на этом аудит однажды прозевал подмену на стенде.
 */
export function declaredCssClasses(css: string): Set<string> {
  const out = new Set<string>()
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const rule of source.matchAll(/([^{}]*)\{/g)) {
    for (const m of rule[1]!.matchAll(/\.((?:\\.|[\w-])+)/g))
      out.add(m[1]!.replace(/\\(.)/g, '$1'))
  }
  return out
}

/** Объявленные в CSS кастом-проперти (без `--`), включая блоки внутри at-rules. */
export function declaredCssTokens(css: string): Set<string> {
  const out = new Set<string>()
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of source.matchAll(/(?<=[{;\s])--([\w-]+)\s*:/g))
    out.add(m[1]!)
  return out
}

/**
 * Токены, достижимые от корней: корень — ссылка вне значения кастом-проперти (в
 * правилах CSS, в JS), далее по значениям объявлений. Токен, на который ссылается
 * только другой мёртвый токен, живым не считается.
 */
export function reachableCssTokens(css: string, js: string): Set<string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const valueRefs = new Map<string, string[]>()
  let stripped = source
  for (const m of source.matchAll(/(?<=[{;\s])--([\w-]+)\s*:([^;}]*)/g)) {
    const refs = [...m[2]!.matchAll(/var\(\s*--([\w-]+)/g)].map(r => r[1]!)
    valueRefs.set(m[1]!, [...(valueRefs.get(m[1]!) ?? []), ...refs])
    stripped = stripped.replace(m[0], '')
  }
  const reachable = new Set<string>()
  for (const m of stripped.matchAll(/var\(\s*--([\w-]+)/g))
    reachable.add(m[1]!)
  for (const m of js.matchAll(/--([a-z][\w-]*)/gi))
    reachable.add(m[1]!)
  const queue = [...reachable]
  while (queue.length > 0) {
    const token = queue.pop()!
    for (const ref of valueRefs.get(token) ?? []) {
      if (!reachable.has(ref)) {
        reachable.add(ref)
        queue.push(ref)
      }
    }
  }
  return reachable
}

/** Классы-селекторы собственного CSS компонента — по файлам из раскладки пакета. */
function ownSelectorsOf(component: GranumManifestComponent, packageDist: string): string[] {
  const out = new Set<string>()
  for (const path of component.css) {
    let text: string
    try {
      text = readFileSync(join(packageDist, path), 'utf8')
    }
    catch {
      continue
    }
    const source = text.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const rule of source.matchAll(/([^{}]*)\{/g)) {
      const prelude = rule[1]!
      if (prelude.trim().startsWith('@'))
        continue
      for (const selector of prelude.split(',')) {
        /*
         * Собственный класс компонента — субъект правила, то есть правый
         * compound: в `.dark .xh-panel__title` это `.xh-panel__title`, а `.dark` —
         * область темы. Старый разбор брал первый класс строки и вменял
         * компоненту тему приложения — на SSR-стенде это давало ложную находку.
         */
        const subject = selector.trim().split(/[\s>+~]+/).pop() ?? ''
        for (const m of subject.matchAll(/\.((?:\\.|[\w-])+)/g))
          out.add(m[1]!.replace(/\\(.)/g, '$1'))
      }
    }
  }
  return [...out]
}

export function granumAuditDist(options: AuditDistOptions): AuditDistReport {
  const dist = options.dist
  const root = options.root ?? dirname(dist)
  const reportFile = options.reportFile ?? 'granum-report.json'
  const enginePrefix = options.enginePrefix ?? '--un-'

  const cssFiles = walk(dist, name => name.endsWith('.css'))
  const jsFiles = walk(dist, name => name.endsWith('.js'))
  const css = cssFiles.map(f => readFileSync(f, 'utf8')).join('\n')
  const js = jsFiles.map(f => readFileSync(f, 'utf8')).join('\n')
  const cssClasses = declaredCssClasses(css)

  const reportPath = walk(dist, name => name === reportFile)[0]
  if (reportPath === undefined) {
    throw new Error(
      `granum audit: no '${reportFile}' in '${dist}' — the audit needs the build report: `
      + 'it carries the selection and the provider list. Check `report.file` in granum.config.',
    )
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as AuditInputReport
  const selection = (report.selection ?? []).map(entry => entry.key)
  if (selection.length === 0)
    throw new Error(`granum audit: the report '${reportPath}' has an empty selection — nothing to audit`)

  const require = createRequire(join(root, 'package.json'))
  const providers: AuditProviderInfo[] = []
  const components: AuditComponentInfo[] = []
  const problems: string[] = []
  const notes: string[] = []
  const packageTokens = new Set<string>()
  const selected = new Set(selection)
  const unmatchedClasses = new Set((report.classes?.unmatched ?? []).map(e => e.className))

  /** Первый проход: манифесты и состав. Судить можно только зная селекцию целиком. */
  interface Loaded {
    readonly key: string
    readonly providerId: string
    readonly name: string
    readonly selected: boolean
    readonly classes: readonly string[]
    readonly safelist: readonly string[]
    readonly selectors: readonly string[]
  }
  const loaded: Loaded[] = []

  /*
   * Список провайдеров берётся из отчёта, а если его там нет — из ключей
   * селекции: они всегда вида `providerId:Name`. Так аудит работает и на отчёте
   * постарше, и на написанном руками — лишь бы селекция была.
   */
  const providerIds = (report.providers ?? []).map(p => p.id)
  const fromSelection = [...new Set(selection.map(key => key.slice(0, key.lastIndexOf(':'))))]
  const entries = (providerIds.length > 0 ? providerIds : fromSelection).map(id => ({ id }))

  for (const entry of entries) {
    let manifestPath: string | undefined
    try {
      manifestPath = require.resolve(`${entry.id}/granum.manifest.json`)
    }
    catch {
      manifestPath = undefined
    }
    if (manifestPath === undefined) {
      providers.push({ id: entry.id, version: null, components: 0, declaredTokens: 0, manifest: false })
      problems.push(`provider ${entry.id}: manifest does not resolve from ${relative(process.cwd(), root) || '.'} — nothing to judge its contents by`)
      continue
    }
    const packageDist = dirname(manifestPath)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as GranumManifest
    for (const token of manifest.theme.declares)
      packageTokens.add(token.replace(/^--/, ''))
    providers.push({
      id: manifest.id,
      version: manifest.version ?? null,
      components: Object.keys(manifest.components).length,
      declaredTokens: manifest.theme.declares.length,
      manifest: true,
    })
    for (const [name, component] of Object.entries(manifest.components)) {
      const key = `${manifest.id}:${name}`
      loaded.push({
        key,
        providerId: manifest.id,
        name,
        selected: selected.has(key),
        classes: component.classes,
        /*
         * `safelist` выбранного компонента — такой же законный источник CSS, как
         * `classes`: это классы, которые он собирает в рантайме. Без них аудит
         * вменял `border-[var(--gr-primary)]` пяти невыбранным компонентам, хотя в CSS
         * класс приехал из safelist выбранного `GrButton`.
         */
        safelist: component.safelist ?? [],
        selectors: ownSelectorsOf(component, packageDist),
      })
    }
  }

  /*
   * Класс невыбранного компонента, которым пользуется и выбранный, находкой не
   * является: `flex` есть у обоих, и в CSS он приехал по праву. Находка — класс,
   * которого нет ни у одного выбранного компонента: попасть в дистрибутив он мог
   * только из невыбранного. Прежняя версия аудита этого не различала и работала
   * лишь потому, что у двух компонентов фикстуры классы не пересекались.
   */
  const classesOfSelected = new Set(loaded.filter(c => c.selected).flatMap(c => [...c.classes, ...c.safelist]))
  /*
   * Классы из разметки самого приложения тоже приехали по праву: `p-4` в
   * `App.vue` не имеет отношения к невыбранному компоненту, у которого он
   * случайно тоже есть. Без этой поправки аудит обвинял компонент в утечке за
   * чужой класс — на стендах это было видно сразу.
   */
  const classesOfApp = new Set(report.classes?.app ?? [])
  /*
   * Классы разметки приложения отчёт перечисляет не всегда: в более старом этого
   * поля нет вовсе. Отличить тогда `gap-3` из `App.vue` от протёкшего класса
   * невыбранного компонента нечем, и аудит отказывается судить, а не выдаёт
   * разметку приложения за утечку: на стендах дизайн-системы это давало десятки
   * ложных находок. Пересборка свежим granum возвращает проверку в строй.
   */
  const appClassesKnown = report.classes?.app !== undefined
  /** Селектор есть и у выбранного компонента (общий `.title`) — в CSS он приехал по праву. */
  const ownOfSelected = new Set(loaded.filter(c => c.selected).flatMap(c => c.selectors))

  for (const component of loaded) {
    const inJs = component.classes.filter(className => js.includes(className))
    const inCss = component.classes.filter(className => cssClasses.has(className))
    const ownInCss = component.selectors.filter(selector => cssClasses.has(selector))

    components.push({
      key: component.key,
      providerId: component.providerId,
      name: component.name,
      selected: component.selected,
      classesInJs: inJs.length,
      classesInCss: inCss.length,
      classes: component.classes.length,
      ownSelectors: component.selectors.length,
      ownSelectorsInCss: ownInCss.length,
    })

    if (component.selected) {
      /*
       * Класс, которому движок приложения не нашёл правила, в CSS и не мог
       * появиться — про него говорит отчёт сборки (`unmatched`), и обвинять
       * доставку во второй раз незачем.
       */
      const missing = component.classes.filter(className => !inCss.includes(className) && !unmatchedClasses.has(className))
      if (missing.length > 0)
        problems.push(`${component.key}: classes missing from the CSS (${missing.join(', ')})`)
      const missingOwn = component.selectors.filter(s => !ownInCss.includes(s))
      if (missingOwn.length > 0)
        problems.push(`${component.key}: own rules missing from the CSS (${missingOwn.join(', ')})`)
      continue
    }

    /*
     * Вердикт выносится по CSS, а не по JS, и это не лень.
     *
     * Класс в JS ищется подстрокой, и `table` находится в любом слове, где эти
     * буквы встретились. Но главное — раскладку чанков выбирает бандлер:
     * `bench-one` группирует весь пакет в один чанк, и класс невыбранного
     * компонента лежит там не потому, что tree-shaking не сработал. granum на
     * JS не влияет вовсе (A-7), поэтому число в колонке `js` — информация, а не
     * обвинение. CSS же granum эмитит сам, и за него отвечает.
     */
    const uniqueClasses = component.classes.filter(className => !classesOfSelected.has(className) && !classesOfApp.has(className))
    const leakedToCss = uniqueClasses.filter(className => cssClasses.has(className))
    if (leakedToCss.length > 0) {
      const line = `${component.key}: classes of an unselected component are in the CSS (${leakedToCss.slice(0, 6).join(', ')}${leakedToCss.length > 6 ? ', …' : ''})`
      ;(appClassesKnown ? problems : notes).push(line)
    }
    const leakedOwn = ownInCss.filter(selector => !ownOfSelected.has(selector))
    if (leakedOwn.length > 0)
      problems.push(`${component.key}: own CSS of an unselected component was shipped (${leakedOwn.join(', ')})`)
  }

  // Токены пакетов -----------------------------------------------------------

  const declared = declaredCssTokens(css)
  const reachable = reachableCssTokens(css, js)
  const prefix = enginePrefix.replace(/^--/, '')
  const inDist = [...packageTokens].filter(token => declared.has(token)).sort()
  const cut = [...packageTokens].filter(token => !declared.has(token)).sort()
  const dead = inDist.filter(token => !reachable.has(token))
  const foreign = [...declared].filter(token => !packageTokens.has(token) && !token.startsWith(prefix)).sort()

  /*
   * Мёртвый токен — находка только там, где обрезка включена: без неё никто и
   * не обещал их снимать, и объявленный, но не использованный токен — норма.
   */
  const pruning = report.prune !== undefined && report.prune !== null && report.prune.mode !== 'off'
  if (dead.length > 0 && pruning)
    problems.push(`package tokens in the dist that nothing can reach: ${dead.map(t => `--${t}`).join(' ')}`)

  const engineVars = [...declared].filter(token => token.startsWith(prefix))

  // Отчёт сборки -------------------------------------------------------------

  /*
   * Находки отчёта — предмет `doctor` и `report --strict`, а не аудита: у стенда
   * они бывают намеренными (класс чужого словаря, мёртвая запись safelist).
   * Аудит их печатает всегда, а в код возврата доводит только с `--strict`.
   */
  const unmatched = report.classes?.unmatched ?? []
  const undefinedTokens = report.tokens?.undefined ?? []
  if (options.strict === true) {
    if (unmatched.length > 0)
      problems.push(`classes with no engine rule: ${unmatched.map(e => e.className).join(', ')}`)
    if (undefinedTokens.length > 0)
      problems.push(`consumed but never declared: ${undefinedTokens.join(', ')}`)
  }

  return {
    dist,
    assets: {
      css: cssFiles.map(f => relative(dist, f)),
      js: jsFiles.map(f => relative(dist, f)),
    },
    providers,
    selection,
    components,
    tokens: { declaredByPackages: packageTokens.size, inDist, cut, dead, foreign },
    engine: { prefix: enginePrefix, declared: engineVars.length, used: engineVars.filter(t => reachable.has(t)).length },
    pruning,
    build: {
      classesMatched: report.classes?.matched ?? 0,
      classesInput: report.classes?.input ?? 0,
      classesUnmatched: unmatched.map(e => e.className),
      tokensUndefined: [...undefinedTokens],
      ...(report.prune
        ? {
            prune: {
              mode: report.prune.mode,
              removed: report.prune.removable.length,
              kept: report.prune.kept,
              deadPatterns: report.prune.deadPatterns.length,
            },
          }
        : {}),
      ...(report.sizes ? { sizes: report.sizes } : {}),
      ...(report.sizesSource ? { sizesSource: report.sizesSource } : {}),
    },
    problems,
    notes,
    ok: problems.length === 0,
  }
}

const pad = (text: string | number, width: number): string => String(text).padEnd(width)

export function formatAuditDistReport(report: AuditDistReport): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)

  push('granum audit')
  push('============')
  push()
  push(`Dist: ${report.dist} — ${report.assets.css.length} CSS, ${report.assets.js.length} JS`)
  push(`Selection (${report.selection.length}): ${report.selection.join(', ')}`)
  push()

  push(`Providers (${report.providers.length}):`)
  for (const p of report.providers) {
    push(p.manifest
      ? `  • ${p.id}${p.version ? `@${p.version}` : ''} — components: ${p.components}, declared tokens: ${p.declaredTokens}`
      : `  ✗ ${p.id} — manifest not resolved`)
  }
  push()

  push('Components (js — information: the chunk layout is the bundler\'s call, granum does not touch JS):')
  const width = Math.max(...report.components.map(c => c.key.length), 10)
  for (const c of report.components) {
    push(
      `  ${pad(c.key, width)}  ${c.selected ? 'selected    ' : 'NOT selected'}`
      + `  js: ${c.classesInJs}/${c.classes}`
      + `  css: ${c.classesInCss}/${c.classes}`
      + `  own css: ${c.ownSelectorsInCss}/${c.ownSelectors}`,
    )
  }
  push()

  push('Package tokens:')
  push(`  declared by packages:  ${report.tokens.declaredByPackages}`)
  push(`  in the dist:           ${report.tokens.inDist.length}`)
  // Без обрезки «нет в дистрибутиве» означает «не попал» (компонент не выбран,
  // тема не включена), а не «снят»: приписывать это обрезке нельзя.
  push(report.pruning
    ? `  cut by pruning:        ${report.tokens.cut.length}`
    : `  not in the dist:       ${report.tokens.cut.length} (pruning is off — never emitted)`)
  push(`  unreachable in dist:   ${report.tokens.dead.length}${report.tokens.dead.length ? ` — ${report.tokens.dead.map(t => `--${t}`).join(' ')}` : ''}${report.tokens.dead.length && !report.pruning ? ' (pruning is off — not a finding)' : ''}`)
  if (report.tokens.foreign.length > 0)
    push(`  declared elsewhere:    ${report.tokens.foreign.length} (application CSS)`)
  push()
  push(`Engine preflight: ${report.engine.declared} \`${report.engine.prefix}*\` variables, ${report.engine.used} referenced by the emitted utilities`)
  push('  a fixed cost of the engine; not a package token and not subject to pruning')
  push()

  push('Build report:')
  push(`  classes: ${report.build.classesMatched} with a rule of ${report.build.classesInput} candidates; without a rule: ${report.build.classesUnmatched.length}`)
  push(`  tokens with no declaration: ${report.build.tokensUndefined.join(' ') || '—'}`)
  if (report.build.prune)
    push(`  pruning (${report.build.prune.mode}): removed ${report.build.prune.removed}, kept ${report.build.prune.kept}, dead patterns ${report.build.prune.deadPatterns}`)
  if (report.build.sizes) {
    push(`  layers (raw / gzip, from the ${report.build.sizesSource ?? 'emission'}):`)
    for (const [layer, size] of Object.entries(report.build.sizes))
      push(`    ${pad(layer, 12)} ${pad(size.raw, 8)} ${size.gzip}`)
  }
  push()

  if (report.notes.length > 0) {
    push('Not judged (the build report has no `classes.app` — rebuild with a newer granum):')
    push(`  - ${report.notes.join('\n  - ')}`)
    push()
  }

  if (report.ok)
    push('✓ Nothing extra in the dist: unselected components are gone, no unreachable tokens left.')
  else
    push(`✗ Findings: ${report.problems.length}\n  - ${report.problems.join('\n  - ')}`)
  return lines.join('\n')
}
