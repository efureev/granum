/**
 * Объектный провайдер с раскладкой `dist` на диске сканируется
 * приложением — классы, потребление токенов, объявления темы, общие чанки.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defineGranumProvider } from '../contract'
import { emitCss } from '../node/emit'
import { collectProviderInstances, scanObjectProvider } from '../node/scanProvider'
import { makeProvider, prepareTestApp } from './helpers'
import { TEST_DIALECT, testEngine } from './testEngine'

function distFixture(): { root: string, dist: string } {
  const root = mkdtempSync(join(tmpdir(), 'granum-scan-'))
  const dist = join(root, 'kit-dist')
  mkdirSync(join(dist, 'components/Card'), { recursive: true })
  mkdirSync(join(dist, 'components/Table'), { recursive: true })
  mkdirSync(join(dist, 'chunks'), { recursive: true })
  mkdirSync(join(dist, 'theme'), { recursive: true })
  writeFileSync(join(dist, 'components/Card/index.js'), 'import { pad } from "../../chunks/shared.js"\nimport "../Table/index.js"\nexport const Card = { cls: "p-4 flex not-a-rule", pad, v: getComputedStyle(document.body).getPropertyValue("--card-fg") }\n')
  writeFileSync(join(dist, 'components/Card/styles.css'), '.card{color:var(--card-fg);margin:var(--space)}\n')
  writeFileSync(join(dist, 'components/Table/index.js'), 'export const Table = { cls: "m-2" }\n')
  writeFileSync(join(dist, 'chunks/shared.js'), 'export const pad = "gap-2"\n')
  writeFileSync(join(dist, 'theme/tokens.css'), ':root{--space:8px;--card-fg:#000}\n')
  return { root, dist }
}

describe('scanObjectProvider', () => {
  it('файлы компонента и общие чанки; классы только с правилом; токены из JS и CSS; тема по файлам', async () => {
    const { dist } = distFixture()
    const provider = defineGranumProvider({
      id: '@x/kit',
      contractVersion: 1,
      baseUrl: `${pathToFileURL(dist).href}/`,
      components: [{ name: 'Card', dependencies: ['Table'], safelist: ['p-4', 'sr-only'] }, { name: 'Table' }],
      theme: { tokensCss: 'theme/tokens.css', tokenDefinitions: { light: { tokens: { accent: 'red' } } } },
    })
    const loaded = (await scanObjectProvider(provider, testEngine()))!
    const card = loaded.manifest.components.Card!
    // Чужая директория компонента — ребро, не файл; общий чанк — файл.
    expect(card.files).toEqual(['chunks/shared.js', 'components/Card/index.js'])
    expect(card.classes).toEqual(['flex', 'gap-2', 'p-4'])
    expect(card.css).toEqual(['components/Card/styles.css'])
    expect(card.tokens.consumes).toEqual(['--card-fg', '--space'])
    expect(card.dependencies).toEqual(['@x/kit:Table'])
    expect(loaded.manifest.components.Table?.classes).toEqual(['m-2'])
    expect(loaded.manifest.theme.declares).toEqual(['--accent', '--card-fg', '--space'])
    // `p-4` извлечение нашло статически, поэтому из safelist он вычищен: записи
    // без собственного CSS в манифест не едут. `sr-only` остался — его
    // движок тестов не знает, и в `classes` его нет.
    expect(card.safelist).toEqual(['sr-only'])
    expect(loaded.manifest.warnings.map(w => w.code)).toEqual(['scanned-provider'])
    expect(loaded.manifest.generatedBy).toContain('(scanned)')
    expect(loaded.baseUrl).toBe(provider.baseUrl)
  })

  it('baseUrl не каталог — undefined; в prepareApp остаётся provider-without-manifest', async () => {
    const fake = makeProvider('@x/fake', { components: [{ name: 'A' }] })
    expect(await scanObjectProvider(fake, testEngine())).toBeUndefined()
    const app = await prepareTestApp({ providers: [fake], components: ['@x/fake:A'], appSources: { dirs: [] } }, tmpdir())
    expect(app.warnings.map(w => w.kind)).toEqual(['provider-without-manifest'])
  })

  it('prepareApp: объектный провайдер даёт классы в CSS и предупреждение provider-scanned; донор-инстанс сканируется тоже', async () => {
    const { root, dist } = distFixture()
    const donor = defineGranumProvider({ id: '@x/base', contractVersion: 1, baseUrl: `${pathToFileURL(dist).href}/`, components: [{ name: 'Table' }], engine: { dialect: TEST_DIALECT, rules: [['kit-reset', { appearance: 'none' }]] } })
    const provider = defineGranumProvider({
      id: '@x/kit',
      contractVersion: 1,
      baseUrl: `${pathToFileURL(dist).href}/`,
      components: [{ name: 'Card', dependencies: ['@x/base:Table'] }],
      dependencies: [donor],
    })
    expect([...collectProviderInstances(provider).keys()]).toEqual(['@x/base'])
    const app = await prepareTestApp({ providers: [provider], components: ['@x/kit:Card'], appSources: { dirs: [] } }, root)
    expect(app.warnings.map(w => `${w.kind}:${'providerId' in w ? w.providerId : ''}`).sort()).toEqual(['provider-scanned:@x/base', 'provider-scanned:@x/kit'])
    expect(app.resolution.selection.order).toEqual(['@x/base:Table', '@x/kit:Card'])
    expect(app.resolution.providers.every(p => p.form === 'manifest')).toBe(true)
    // Правила движка объектного донора не теряются при подмене на синтетический манифест.
    expect(app.engineContribution.rules?.length).toBe(1)
    const css = await emitCss(app)
    expect(css.layers.utilities).toContain('.p-4{')
    expect(css.layers.utilities).toContain('.m-2{')
    expect(css.layers.components).toContain('.card{')
  })
})

describe('объектные доноры в dependencies', () => {
  const css = `data:text/css,${encodeURIComponent(':root { --b-bg: red; }')}`
  const donor = (): ReturnType<typeof makeProvider> => makeProvider('b', { theme: { defaultThemes: ['light'], tokenDefinitionsRef: { light: css } } })
  const lightTokens = (app: Awaited<ReturnType<typeof prepareTestApp>>): string[] =>
    (app.resolution.tokenLayers.get('light') ?? []).flatMap(block => [...block.tokens.keys()])

  it('донор с tokenDefinitionsRef и в providers, и в dependencies — один провайдер', async () => {
    // Материализация даёт новый объект; ссылка из dependencies — старый. По
    // идентичности это два инстанса с одним id, а не ромб.
    const b = donor()
    const a = makeProvider('a', { dependencies: [b] })
    const app = await prepareTestApp({ providers: [a, b], themes: { names: ['light'] } }, mkdtempSync(join(tmpdir(), 'granum-donor-')))
    expect(app.resolution.providers.map(p => p.id)).toEqual(['b', 'a'])
    expect(lightTokens(app)).toContain('b-bg')
  })

  it('донор только в dependencies тоже материализуется: его токены доходят до темы', async () => {
    const a = makeProvider('a', { dependencies: [donor()] })
    const app = await prepareTestApp({ providers: [a], themes: { names: ['light'] } }, mkdtempSync(join(tmpdir(), 'granum-donor-')))
    expect(app.resolution.providers.map(p => p.id)).toEqual(['b', 'a'])
    expect(lightTokens(app)).toContain('b-bg')
  })

  it('донор с dist сканируется в манифест, зависящий без dist — нет: конфликта нет', async () => {
    const { root, dist } = distFixture()
    const base = defineGranumProvider({ id: '@x/base', contractVersion: 1, baseUrl: `${pathToFileURL(dist).href}/`, components: [{ name: 'Table' }] })
    const a = makeProvider('a', { dependencies: [base] })
    const app = await prepareTestApp({ providers: [a] }, root)
    expect(app.resolution.providers.map(p => `${p.form}:${p.id}`)).toEqual(['manifest:@x/base', 'object:a'])
  })

  it('два разных инстанса с одним id — по-прежнему конфликт', async () => {
    const a = makeProvider('a', { dependencies: [donor()] })
    await expect(prepareTestApp({ providers: [a, donor()] }, mkdtempSync(join(tmpdir(), 'granum-donor-')))).rejects.toMatchObject({ name: 'DuplicateProviderIdError' })
  })
})
