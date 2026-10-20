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
  mkdirSync(join(dist, 'themes'), { recursive: true })
  writeFileSync(join(dist, 'themes/kit.json'), JSON.stringify({ id: 'kit', title: 'Kit', root: { accent: 'red' }, modes: { light: { colorScheme: 'light', tokens: {} }, dark: { colorScheme: 'dark', tokens: {} } } }))
  return { root, dist }
}

describe('scanObjectProvider', () => {
  it('токен только с запасным значением — tokens.optional, хуки дескриптора — tokens.hooks', async () => {
    const { dist } = distFixture()
    writeFileSync(join(dist, 'components/Table/styles.css'), '.t{color:var(--hook, red);border-color:var(--lost, red);margin:var(--space, 0);width:var(--set, 1px)}\n')
    // Имя строковым литералом — возможно присваивание в рантайме: `setProperty`.
    writeFileSync(join(dist, 'components/Table/index.js'), 'export const Table = { cls: "m-2", set: el => el.style.setProperty("--set", "2px") }\n')
    const provider = defineGranumProvider({
      id: '@x/kit',
      contractVersion: 2,
      baseUrl: `${pathToFileURL(dist).href}/`,
      components: [{ name: 'Card', dependencies: ['Table'] }, { name: 'Table', hookTokens: ['hook'] }],
    })
    const table = (await scanObjectProvider(provider, testEngine()))!.manifest.components.Table!
    expect(table.tokens.optional).toEqual(['--hook', '--lost', '--space'])
    expect(table.tokens.hooks).toEqual(['--hook'])
  })

  it('файлы компонента и общие чанки; классы только с правилом; токены из JS и CSS; индекс каталога по данным', async () => {
    const { dist } = distFixture()
    const provider = defineGranumProvider({
      id: '@x/kit',
      contractVersion: 2,
      baseUrl: `${pathToFileURL(dist).href}/`,
      components: [{ name: 'Card', dependencies: ['Table'], safelist: ['p-4', 'sr-only'] }, { name: 'Table' }],
      theme: { tokensCss: 'theme/tokens.css', defaultTheme: 'kit', catalog: { kit: { title: 'Kit', data: 'themes/kit.json' } } },
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
    expect(loaded.manifest.theme.catalog).toEqual({ kit: { title: 'Kit', data: 'themes/kit.json', modes: ['light', 'dark'], defaultMode: 'light' } })
    // `p-4` извлечение нашло статически, поэтому из safelist он вычищен: записи
    // без собственного CSS в манифест не едут. `sr-only` остался — его
    // движок тестов не знает, и в `classes` его нет.
    expect(card.safelist).toEqual(['sr-only'])
    expect(loaded.manifest.warnings.map(w => w.code)).toEqual(['scanned-provider'])
    expect(loaded.manifest.generatedBy).toContain('(scanned)')
    expect(loaded.baseUrl).toBe(provider.baseUrl)
  })

  /**
   * Части составного компонента — как их записала бы сборка: по `exports`
   * пакета, в котором лежит раскладка, если это пакет самого провайдера.
   */
  it('части составного компонента — из exports пакета провайдера; чужой package.json не в счёт', async () => {
    const { root, dist } = distFixture()
    const provider = defineGranumProvider({ id: '@x/kit', contractVersion: 1, baseUrl: `${pathToFileURL(dist).href}/`, components: [{ name: 'Card' }, { name: 'Table' }] })
    const exports = { './components/Card': './kit-dist/components/Card/index.js', './components/CardPart': './kit-dist/components/Card/index.js' }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@x/kit', exports }))
    const own = (await scanObjectProvider(provider, testEngine()))!
    expect(own.manifest.components.Card?.subcomponents).toEqual(['CardPart'])
    expect(own.manifest.components.Table).not.toHaveProperty('subcomponents')

    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'some-monorepo', exports }))
    const foreign = (await scanObjectProvider(provider, testEngine()))!
    expect(foreign.manifest.components.Card).not.toHaveProperty('subcomponents')
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
  /** Донор — владелец каталога: данные темы на диске, база — его каталог. */
  const donor = (): ReturnType<typeof makeProvider> => {
    const dir = mkdtempSync(join(tmpdir(), 'granum-donor-theme-'))
    mkdirSync(join(dir, 'themes'))
    writeFileSync(join(dir, 'themes/paper.json'), JSON.stringify({ id: 'paper', title: 'P', root: {}, modes: { light: { colorScheme: 'light', tokens: { 'b-bg': 'red' } } } }))
    return makeProvider('b', { baseUrl: `${pathToFileURL(dir).href}/`, theme: { defaultTheme: 'paper', catalog: { paper: { title: 'P', data: 'themes/paper.json' } } } })
  }
  const lightTokens = (app: Awaited<ReturnType<typeof prepareTestApp>>): string[] => [...(app.resolution.tokens.active?.modes.get('light')?.keys() ?? [])]

  it('донор-владелец тем и в providers, и в dependencies — один провайдер', async () => {
    // Материализация даёт новый объект; ссылка из dependencies — старый. По
    // идентичности это два инстанса с одним id, а не ромб.
    const b = donor()
    const a = makeProvider('a', { dependencies: [b] })
    const app = await prepareTestApp({ providers: [a, b] }, mkdtempSync(join(tmpdir(), 'granum-donor-')))
    expect(app.resolution.providers.map(p => p.id)).toEqual(['b', 'a'])
    expect(lightTokens(app)).toContain('b-bg')
  })

  it('донор только в dependencies тоже подключается: его тема доходит до CSS', async () => {
    const a = makeProvider('a', { dependencies: [donor()] })
    const app = await prepareTestApp({ providers: [a] }, mkdtempSync(join(tmpdir(), 'granum-donor-')))
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
