/**
 * Сверка движка приложения с движком пакета — таблица решений §8 ТЗ движка
 * (A-E3…A-E8, INV-ENG-8, INV-ENG-11, INV-ENG-12).
 *
 * Стенд один: пакет на диске, чьи файлы содержат три класса, и манифест, в
 * котором записаны только два — как если бы сборку пакета вёл движок, третьего
 * имени не знавший. Дальше меняется только движок приложения.
 */
import type { GranumLoadedManifest } from '../contract'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearReextractCache } from '../node/dialects'
import { emitCss } from '../node/emit'
import { buildReport } from '../node/report'
import { makeManifest, prepareTestApp, TEST_ENGINE } from './helpers'
import { TEST_DIALECT, testEngine } from './testEngine'

/** Класс, который знает движок приложения из кейсов, но не знал движок сборки пакета. */
const GAINED = 'zz-extra'
/** Класс, записанный в манифест и неизвестный ни одному движку тестов. */
const LOST = 'zz-gone'

interface Fixture {
  readonly root: string
  readonly manifest: GranumLoadedManifest
}

/**
 * `classes` — то, что записано в манифесте; в файлах компонента всегда лежат
 * `p-4 flex zz-extra`. Расхождение между файлами и манифестом и есть предмет
 * проверки.
 */
function fixture(options: {
  readonly dialect?: string | null
  readonly vocabulary?: string | null
  readonly classes?: readonly string[]
  readonly module?: string | null
} = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'granum-dialect-'))
  const dist = join(root, 'node_modules/@x/kit/dist')
  mkdirSync(join(dist, 'components/Card'), { recursive: true })
  writeFileSync(join(root, 'node_modules/@x/kit/package.json'), JSON.stringify({
    name: '@x/kit',
    version: '1.0.0',
    exports: { './granum.manifest.json': './dist/granum.manifest.json' },
  }))
  writeFileSync(join(dist, 'components/Card/index.js'), `export const Card = { cls: "p-4 flex ${GAINED}" }\n`)
  writeFileSync(join(dist, 'rules.mjs'), `export default { rules: [['${GAINED}', { color: 'red' }]] }\n`)

  const dialect = options.dialect === undefined ? TEST_DIALECT : options.dialect
  const vocabulary = options.vocabulary === undefined ? TEST_ENGINE.vocabulary : options.vocabulary
  const loaded = makeManifest('@x/kit', {
    Card: { classes: options.classes ?? ['flex', 'p-4'], files: ['components/Card/index.js'] },
  }, {
    engine: { dialect, vocabulary, name: 'packager-engine', version: '1.0.0', module: options.module ?? null },
  })
  return { root, manifest: { manifest: loaded.manifest, baseUrl: `${pathToFileURL(dist).href}/` } }
}

describe('сверка диалектов и отпечатков (A-E3, таблица §8)', () => {
  beforeEach(() => {
    clearReextractCache()
  })

  it('диалект и отпечаток совпали — быстрый путь, классы из манифеста', async () => {
    const f = fixture()
    const app = await prepareTestApp({ providers: [f.manifest], components: ['@x/kit:Card'] }, f.root)
    const [decision] = app.engineDecisions
    expect(decision).toMatchObject({ providerId: '@x/kit', classes: 'manifest', reason: 'none', lost: [], gained: [] })
    // `zz-extra` лежит в файлах пакета, но его нет в манифесте — и это не наше
    // дело: отпечатки совпали, значит список полон по построению.
    expect(app.resolution.classes).toEqual(['flex', 'p-4'])
  })

  it('диалект тот же, отпечаток другой, движок знает больше — класс возвращается (AC-E6, INV-ENG-11)', async () => {
    const f = fixture()
    const engine = testEngine({ extra: { [GAINED]: 'color:red;' } })
    expect(engine.dialect).toBe(TEST_ENGINE.dialect)
    expect(engine.vocabulary).not.toBe(TEST_ENGINE.vocabulary)

    const app = await prepareTestApp({ providers: [f.manifest], components: ['@x/kit:Card'], engine }, f.root)
    const [decision] = app.engineDecisions
    expect(decision).toMatchObject({ classes: 're-extracted', reason: 'vocabulary', gained: [GAINED], lost: [] })
    expect(app.resolution.classes).toEqual(['flex', 'p-4', GAINED])
    const css = await emitCss(app)
    expect(css.layers.utilities).toContain(`.${GAINED}{color:red;}`)
  })

  it('класс манифеста, которого движок приложения не знает, остаётся виден в unmatched (A-E7)', async () => {
    const f = fixture({ classes: ['flex', 'p-4', LOST], vocabulary: 'fnv64-otherpackager0' })
    const app = await prepareTestApp({ providers: [f.manifest], components: ['@x/kit:Card'] }, f.root)
    const [decision] = app.engineDecisions
    expect(decision).toMatchObject({ classes: 're-extracted', reason: 'vocabulary', lost: [LOST] })
    expect(app.reextractLost).toEqual([LOST])
    // Пересчёт выкинул класс из списка компонента, но не из вида: он в входе
    // движка, в `unmatched` и с названным источником.
    const css = await emitCss(app)
    expect(css.engineInput).toContain(LOST)
    expect(css.engine.unmatched).toContain(LOST)
    const report = buildReport(app, css)
    expect(report.classes.unmatched.find(e => e.className === LOST)?.sources).toEqual(['@x/kit'])
  })

  it('чужой диалект — правила пакета не грузятся, и это видно (INV-ENG-8, AC-E5)', async () => {
    const f = fixture({ dialect: 'other/atoms@1', module: 'rules.mjs' })
    const app = await prepareTestApp({ providers: [f.manifest], components: ['@x/kit:Card'] }, f.root)
    const [decision] = app.engineDecisions
    expect(decision).toMatchObject({ classes: 're-extracted', reason: 'dialect', rulesLoaded: false, rulesSkipped: true })
    expect(app.engineContribution.rules).toEqual([])
    // Класс из правил пакета не сгенерирован: правило не исполнялось.
    expect(app.resolution.classes).toEqual(['flex', 'p-4'])
  })

  it('свой диалект с модулем правил — правила грузятся и участвуют в пересчёте (A-E4, A-E6)', async () => {
    const f = fixture({ module: 'rules.mjs', vocabulary: 'fnv64-otherpackager0' })
    const app = await prepareTestApp({ providers: [f.manifest], components: ['@x/kit:Card'] }, f.root)
    const [decision] = app.engineDecisions
    expect(decision).toMatchObject({ classes: 're-extracted', reason: 'vocabulary', rulesLoaded: true, gained: [GAINED] })
    expect(app.engineContribution.rules).toHaveLength(1)
    const css = await emitCss(app)
    expect(css.layers.utilities).toContain(`.${GAINED}{color:red;}`)
  })

  it('диалект null — быстрый путь при любом движке', async () => {
    const f = fixture({ dialect: null, vocabulary: null, classes: [] })
    const app = await prepareTestApp({ providers: [f.manifest], components: ['@x/kit:Card'], engine: testEngine({ dialect: 'other/atoms@1' }) }, f.root)
    expect(app.engineDecisions[0]).toMatchObject({ classes: 'manifest', reason: 'none', dialect: null, vocabulary: null })
  })

  it('другая версия реализации при том же отпечатке пересчёта не вызывает (INV-ENG-12, AC-E7)', async () => {
    const f = fixture()
    const newer = testEngine({ version: '99.0.0' })
    expect(newer.vocabulary).toBe(TEST_ENGINE.vocabulary)
    const app = await prepareTestApp({ providers: [f.manifest], components: ['@x/kit:Card'], engine: newer }, f.root)
    expect(app.engineDecisions[0]).toMatchObject({ classes: 'manifest', reason: 'none' })
  })

  it('отчёт и доктор называют движок, словарь и отпечаток (D-E1, D-E2)', async () => {
    const f = fixture({ classes: ['flex', 'p-4', LOST], vocabulary: 'fnv64-otherpackager0' })
    const app = await prepareTestApp({ providers: [f.manifest], components: ['@x/kit:Card'] }, f.root)
    const report = buildReport(app, await emitCss(app))
    expect(report.engine).toEqual({ name: TEST_ENGINE.name, dialect: TEST_ENGINE.dialect, vocabulary: TEST_ENGINE.vocabulary })
    expect(report.providers[0]).toMatchObject({ id: '@x/kit', engineName: 'packager-engine', classes: 're-extracted', reason: 'vocabulary', lost: [LOST] })
  })
})
