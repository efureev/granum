import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declaredCssClasses, declaredCssTokens, formatAuditDistReport, granumAuditDist, reachableCssTokens } from '../node/diagnostics/auditDist'
import { makeManifest } from './helpers'

/**
 * Аудит смотрит на СОБРАННЫЙ дистрибутив, поэтому фикстура здесь — не резолюция,
 * а каталог `dist` с ассетами и отчётом плюс пакет в `node_modules` с манифестом.
 * Ровно то, что аудит получит в чужом репозитории.
 */
interface Fixture {
  readonly root: string
  readonly dist: string
}

function fixture(patch: {
  readonly css?: string
  readonly js?: string
  readonly selection?: readonly string[]
  readonly unmatched?: readonly string[]
  readonly undefinedTokens?: readonly string[]
  readonly appClasses?: readonly string[]
  readonly cardSafelist?: readonly string[]
  readonly cardCss?: string
  /** Отчёт от granum постарше: поля `classes.app` в нём нет вовсе. */
  readonly withoutAppClasses?: boolean
  readonly prune?: null
} = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'granum-audit-'))
  const packageDist = join(root, 'node_modules/@x/kit/dist')
  mkdirSync(join(packageDist, 'components/Card'), { recursive: true })
  mkdirSync(join(packageDist, 'components/Badge'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', private: true }))
  writeFileSync(join(root, 'node_modules/@x/kit/package.json'), JSON.stringify({
    name: '@x/kit',
    version: '1.0.0',
    exports: { './granum.manifest.json': './dist/granum.manifest.json' },
  }))
  writeFileSync(join(packageDist, 'components/Card/styles.css'), patch.cardCss ?? '.x-card{color:var(--kit-fg)}\n')
  writeFileSync(join(packageDist, 'components/Badge/styles.css'), '.x-badge{color:red}\n')

  const loaded = makeManifest('@x/kit', {
    Card: { classes: ['p-4', 'flex'], css: ['components/Card/styles.css'], safelist: patch.cardSafelist ?? [] },
    Badge: { classes: ['rounded-badge', 'flex'], css: ['components/Badge/styles.css'] },
  }, {
    theme: { themes: {}, defaultThemes: [], tokenDefinitions: {}, declares: ['--kit-fg', '--kit-bg', '--kit-dead'] },
  })
  writeFileSync(join(packageDist, 'granum.manifest.json'), JSON.stringify(loaded.manifest))

  const dist = join(root, 'dist')
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(join(dist, 'assets/index-abc.css'), patch.css ?? [
    ':root{--kit-fg:#111;--kit-bg:#fff}',
    '.x-card{color:var(--kit-fg)}',
    '.p-4{padding:1rem}',
    '.flex{display:flex}',
    'body{background:var(--kit-bg)}',
  ].join('\n'))
  writeFileSync(join(dist, 'assets/index-abc.js'), patch.js ?? 'const cls = "p-4 flex"\n')
  writeFileSync(join(dist, 'granum-report.json'), JSON.stringify({
    selection: (patch.selection ?? ['@x/kit:Card']).map(key => ({ key })),
    providers: [{ id: '@x/kit', form: 'manifest' }],
    classes: {
      input: 4,
      matched: 3,
      unmatched: (patch.unmatched ?? []).map(className => ({ className, sources: ['@x/kit:Card'] })),
      ...(patch.withoutAppClasses ? {} : { app: patch.appClasses ?? [] }),
    },
    tokens: { undefined: patch.undefinedTokens ?? [] },
    prune: patch.prune === null ? null : { mode: 'on', removable: ['--kit-dead'], kept: 2, deadPatterns: [] },
    sizes: { total: { raw: 10, gzip: 5 } },
    sizesSource: 'bundle',
  }))
  return { root, dist }
}

describe('granumAuditDist (D-9, INV-DIST-1)', () => {
  it('чистый дистрибутив: невыбранный компонент вырезан, недостижимых токенов нет', () => {
    const f = fixture()
    const report = granumAuditDist({ dist: f.dist })

    expect(report.ok).toBe(true)
    expect(report.problems).toEqual([])
    expect(report.selection).toEqual(['@x/kit:Card'])
    expect(report.providers).toEqual([{ id: '@x/kit', version: '0.0.0', components: 2, declaredTokens: 3, manifest: true }])
    const card = report.components.find(c => c.name === 'Card')!
    expect(card.selected).toBe(true)
    expect(card.classesInCss).toBe(2)
    expect(card.ownSelectorsInCss).toBe(1)
    // `--kit-dead` обрезка вырезала, `--kit-fg` и `--kit-bg` доехали и достижимы.
    expect(report.tokens.inDist).toEqual(['kit-bg', 'kit-fg'])
    expect(report.tokens.cut).toEqual(['kit-dead'])
    expect(report.tokens.dead).toEqual([])
    expect(formatAuditDistReport(report)).toContain('✓ Nothing extra in the dist')
  })

  /**
   * Класс невыбранного компонента, которым пользуется и выбранный (`flex`),
   * находкой быть не может: в CSS он приехал по праву. Прежняя версия аудита
   * этого не различала и работала лишь потому, что у двух компонентов фикстуры
   * классы не пересекались.
   */
  it('общий класс выбранного и невыбранного находкой не считается', () => {
    const f = fixture()
    const report = granumAuditDist({ dist: f.dist })
    const badge = report.components.find(c => c.name === 'Badge')!

    expect(badge.selected).toBe(false)
    expect(badge.classesInCss).toBe(1)
    expect(report.problems).toEqual([])
  })

  it('уникальный класс невыбранного компонента в CSS — находка', () => {
    const f = fixture({
      css: ':root{--kit-fg:#111;--kit-bg:#fff}.x-card{color:var(--kit-fg)}.p-4{padding:1rem}.flex{display:flex}.rounded-badge{border-radius:2px}body{background:var(--kit-bg)}',
    })
    const report = granumAuditDist({ dist: f.dist })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('classes of an unselected component are in the CSS (rounded-badge)')
  })

  /**
   * Собственный класс компонента — субъект правила, а не первый класс строки:
   * в `.dark .x-card` компоненту принадлежит `.x-card`, а `.dark` — область темы
   * приложения. Старый разбор вменял тему компоненту и давал ложную находку
   * на SSR-стенде.
   */
  it('область темы в собственном CSS классом компонента не считается', () => {
    const f = fixture({ cardCss: '.x-card{color:var(--kit-fg)}\n[data-theme=\'dark\'] .x-card,\n.dark .x-card{color:#fff}\n' })
    const report = granumAuditDist({ dist: f.dist })

    const card = report.components.find(c => c.name === 'Card')!
    expect(card.ownSelectors).toBe(1)
    expect(report.problems).toEqual([])
  })

  /**
   * `safelist` выбранного компонента — такой же законный источник CSS, как
   * `classes`. На дизайн-системе именно через safelist едет тоновая утилита
   * кнопки, и без этой поправки аудит вменял её пяти невыбранным компонентам.
   */
  it('класс из safelist выбранного компонента не вменяется невыбранному', () => {
    const f = fixture({
      css: ':root{--kit-fg:#111;--kit-bg:#fff}.x-card{color:var(--kit-fg)}.p-4{padding:1rem}.flex{display:flex}.rounded-badge{border-radius:2px}body{background:var(--kit-bg)}',
      cardSafelist: ['rounded-badge'],
    })
    const report = granumAuditDist({ dist: f.dist })

    expect(report.ok).toBe(true)
  })

  /**
   * Отчёт от granum постарше классов приложения не знает, и отличить их от
   * протёкшего класса нечем. Аудит говорит об этом вслух и не роняет код возврата:
   * иначе любое приложение, собранное до 0.6.0, выглядело бы сломанным.
   */
  it('отчёт без classes.app: аудит не судит, а объясняет', () => {
    const f = fixture({
      css: ':root{--kit-fg:#111;--kit-bg:#fff}.x-card{color:var(--kit-fg)}.p-4{padding:1rem}.flex{display:flex}.rounded-badge{border-radius:2px}body{background:var(--kit-bg)}',
      withoutAppClasses: true,
    })
    const report = granumAuditDist({ dist: f.dist })

    expect(report.ok).toBe(true)
    expect(report.problems).toEqual([])
    expect(report.notes.join('\n')).toContain('classes of an unselected component are in the CSS (rounded-badge)')
    expect(formatAuditDistReport(report)).toContain('Not judged')
  })

  /**
   * Присутствие класса сверяется точно, а не по подстроке: `.x-card__title`
   * содержит `.x-card`, и аудит по подстроке считал выпиленное правило
   * живым. Именно так он прозевал подмену на стенде `bench-one`.
   */
  it('собственное правило, от которого остался только элемент, считается потерянным', () => {
    const f = fixture({
      css: ':root{--kit-fg:#111;--kit-bg:#fff}.x-card__title{font-weight:700}.p-4{padding:1rem}.flex{display:flex}body{background:var(--kit-bg)}',
    })
    const report = granumAuditDist({ dist: f.dist })

    expect(report.problems.join('\n')).toContain('own rules missing from the CSS (x-card)')
  })

  it('declaredCssClasses: экранирование снимается, значения не читаются', () => {
    const classes = declaredCssClasses('.bg-\\[var\\(--x\\)\\]{background:var(--x)}.p-1\\.5{padding:1.5rem}@media (min-width:40rem){.sm\\:flex{display:flex}}')

    expect([...classes].sort()).toEqual(['bg-[var(--x)]', 'p-1.5', 'sm:flex'])
  })

  /**
   * Вердикт выносится по CSS, а не по JS: раскладку чанков выбирает бандлер, и
   * класс невыбранного компонента лежит в общем чанке не потому, что
   * tree-shaking не сработал. granum на JS не влияет вовсе (A-7), поэтому число
   * в колонке `js` — информация, а не обвинение.
   */
  it('класс невыбранного компонента только в JS находкой не считается', () => {
    const f = fixture({ js: 'const cls = "p-4 flex rounded-badge"\n' })
    const report = granumAuditDist({ dist: f.dist })

    const badge = report.components.find(c => c.name === 'Badge')!
    expect(badge.classesInJs).toBe(2)
    expect(report.ok).toBe(true)
  })

  /**
   * Класс из разметки самого приложения приехал по праву, даже если он случайно
   * есть и у невыбранного компонента: `rounded-badge` в `App.vue` к компоненту
   * отношения не имеет.
   */
  it('класс приложения не вменяется невыбранному компоненту', () => {
    const f = fixture({
      css: ':root{--kit-fg:#111;--kit-bg:#fff}.x-card{color:var(--kit-fg)}.p-4{padding:1rem}.flex{display:flex}.rounded-badge{border-radius:2px}body{background:var(--kit-bg)}',
      appClasses: ['rounded-badge'],
    })
    const report = granumAuditDist({ dist: f.dist })

    expect(report.ok).toBe(true)
  })

  it('собственный CSS невыбранного компонента — находка даже без его классов', () => {
    const f = fixture({
      css: ':root{--kit-fg:#111;--kit-bg:#fff}.x-card{color:var(--kit-fg)}.x-badge{color:red}.p-4{padding:1rem}.flex{display:flex}body{background:var(--kit-bg)}',
    })
    const report = granumAuditDist({ dist: f.dist })

    expect(report.problems.join('\n')).toContain('own CSS of an unselected component was shipped (x-badge)')
  })

  it('токен пакета в дистрибутиве, до которого не дотянуться, — мёртвый груз', () => {
    const f = fixture({
      css: ':root{--kit-fg:#111;--kit-bg:#fff;--kit-dead:1px}.x-card{color:var(--kit-fg)}.p-4{padding:1rem}.flex{display:flex}body{background:var(--kit-bg)}',
    })
    const report = granumAuditDist({ dist: f.dist })

    expect(report.tokens.dead).toEqual(['kit-dead'])
    expect(report.problems.join('\n')).toContain('nothing can reach: --kit-dead')
  })

  it('класс выбранного компонента, которого нет в CSS, — находка', () => {
    const f = fixture({ css: ':root{--kit-fg:#111;--kit-bg:#fff}.x-card{color:var(--kit-fg)}.flex{display:flex}body{background:var(--kit-bg)}' })
    const report = granumAuditDist({ dist: f.dist })

    expect(report.problems.join('\n')).toContain('@x/kit:Card: classes missing from the CSS (p-4)')
  })

  /**
   * Находки отчёта — предмет `doctor` и `report --strict`: у стенда они бывают
   * намеренными (класс чужого словаря, мёртвая запись safelist). Аудит печатает
   * их всегда, а роняет код возврата только с `--strict`.
   */
  it('находки отчёта сборки доводятся до кода возврата только с --strict', () => {
    const f = fixture({ unmatched: ['nonsense'], undefinedTokens: ['--nowhere'] })

    const lenient = granumAuditDist({ dist: f.dist })
    expect(lenient.ok).toBe(true)
    expect(lenient.build.classesUnmatched).toEqual(['nonsense'])
    expect(lenient.build.prune).toEqual({ mode: 'on', removed: 1, kept: 2, deadPatterns: 0 })

    const strict = granumAuditDist({ dist: f.dist, strict: true })
    expect(strict.ok).toBe(false)
    expect(strict.problems.join('\n')).toContain('classes with no engine rule: nonsense')
    expect(strict.problems.join('\n')).toContain('consumed but never declared: --nowhere')
  })

  /**
   * Класс выбранного компонента, которому движок не нашёл правила, в CSS и не
   * мог появиться: про него говорит `unmatched`, и обвинять доставку во второй
   * раз незачем. На стенде чужого диалекта таких классов весь компонент.
   */
  it('класс без правила движка недоставленным не считается', () => {
    const f = fixture({
      css: ':root{--kit-fg:#111;--kit-bg:#fff}.x-card{color:var(--kit-fg)}.flex{display:flex}body{background:var(--kit-bg)}',
      unmatched: ['p-4'],
    })
    const report = granumAuditDist({ dist: f.dist })

    expect(report.problems.join('\n')).not.toContain('classes missing from the CSS')
  })

  it('без обрезки недостижимый токен — не находка: снимать его никто не обещал', () => {
    const f = fixture({
      css: ':root{--kit-fg:#111;--kit-bg:#fff;--kit-dead:1px}.x-card{color:var(--kit-fg)}.p-4{padding:1rem}.flex{display:flex}body{background:var(--kit-bg)}',
      prune: null,
    })
    const report = granumAuditDist({ dist: f.dist })

    expect(report.pruning).toBe(false)
    expect(report.tokens.dead).toEqual(['kit-dead'])
    expect(report.ok).toBe(true)
  })

  it('без отчёта сборки аудит отказывается работать, а не гадает', () => {
    const f = fixture()
    expect(() => granumAuditDist({ dist: f.dist, reportFile: 'nope.json' })).toThrow(/no 'nope\.json'/)
  })

  it('манифест провайдера не резолвится — это находка, а не молчание', () => {
    const f = fixture()
    // `root` без `node_modules` пакета: резолвить манифест неоткуда.
    const empty = mkdtempSync(join(tmpdir(), 'granum-audit-root-'))
    writeFileSync(join(empty, 'package.json'), JSON.stringify({ name: 'empty', private: true }))
    const report = granumAuditDist({ dist: f.dist, root: empty })

    expect(report.ok).toBe(false)
    expect(report.providers[0]!.manifest).toBe(false)
    expect(report.problems.join('\n')).toContain('manifest does not resolve')
  })
})

describe('токены дистрибутива: объявления и достижимость', () => {
  it('объявления находятся и внутри at-rules, комментарии не считаются', () => {
    const declared = declaredCssTokens('@media print{:root{--a:1}}/* --b:2 */ .x{--c:3}')
    expect([...declared].sort()).toEqual(['a', 'c'])
  })

  it('токен, на который ссылается только мёртвый токен, живым не считается', () => {
    const css = ':root{--live:1;--dead:2;--via-dead:var(--dead)}.x{color:var(--live)}'
    const reachable = reachableCssTokens(css, '')
    expect(reachable.has('live')).toBe(true)
    expect(reachable.has('dead')).toBe(false)
    expect(reachable.has('via-dead')).toBe(false)
  })

  it('ссылка из JS делает токен живым: имя приходит инлайн-стилем', () => {
    expect(reachableCssTokens(':root{--x:1}', `el.style.setProperty('--x', v)`).has('x')).toBe(true)
  })
})
