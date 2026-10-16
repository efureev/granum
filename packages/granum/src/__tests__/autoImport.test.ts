/**
 * Резолвер auto-import и селекция по тегам в режиме `'imports'`.
 * Кэш манифестов по stat файла и кэш вывода движка по множеству классов.
 */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ownerOf, toProviderNode } from '../core/providerNode'
import { scanAppSources } from '../node/appSources'
import { granumExplain } from '../node/diagnostics/explain'
import { clearManifestCache, loadPackageManifest, serializeManifest } from '../node/manifest'
import { importSelection, tagSelection } from '../node/prepare'
import { buildComponentIndex, granumResolver } from '../vite/resolver'
import { component as makeComponent, makeManifest, makeProvider, prepareTestApp } from './helpers'
import { testEngine } from './testEngine'

function appWithManifest(): { root: string, dist: string } {
  const root = mkdtempSync(join(tmpdir(), 'granum-autoimport-'))
  const dist = join(root, 'node_modules/@x/kit/dist')
  mkdirSync(join(dist, 'components/Card'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'node_modules/@x/kit/package.json'), JSON.stringify({ name: '@x/kit', exports: { './granum.manifest.json': './dist/granum.manifest.json' } }))
  const { manifest } = makeManifest('@x/kit', { Card: { classes: ['p-4'] }, Panel: { classes: ['flex'], dependencies: ['Card'] } })
  writeFileSync(join(dist, 'granum.manifest.json'), serializeManifest(manifest))
  return { root, dist }
}

describe('granumResolver', () => {
  it('отдаёт subpath по имени; неизвестное и неоднозначное имя — undefined', () => {
    const { root } = appWithManifest()
    const other = makeProvider('@x/other', { components: [makeComponent('Card'), makeComponent('Modal')] })
    const resolver = granumResolver({ providers: ['@x/kit', other] }, { root })
    expect(resolver.type).toBe('component')
    expect(resolver.resolve('Panel')).toEqual({ name: 'Panel', from: '@x/kit/components/Panel' })
    expect(resolver.resolve('Modal')).toEqual({ name: 'Modal', from: '@x/other/components/Modal' })
    // `Card` есть у обоих провайдеров — резолвер не гадает.
    expect(resolver.resolve('Card')).toBeUndefined()
    expect(resolver.resolve('Nope')).toBeUndefined()
    expect(resolver.names()).toEqual(['Modal', 'Panel'])
    const scoped = buildComponentIndex({ providers: ['@x/kit', other] }, root, { providers: ['@x/kit'] })
    expect([...scoped.keys()].sort()).toEqual(['Card', 'Panel'])
    expect([...buildComponentIndex({ providers: ['@x/kit'] }, root, { prefix: 'Pa' }).keys()]).toEqual(['Panel'])
  })

  /**
   * Часть составного компонента резолвится своим подпутём: guard и селекция
   * сводят его к владельцу. Правило неоднозначности — то же, что у тегов.
   */
  it('части составных компонентов: подпуть части, компонент первичен, неоднозначная часть — undefined', () => {
    const root = mkdtempSync(join(tmpdir(), 'granum-resolver-parts-'))
    const list = makeManifest('@x/list', { XList: { subcomponents: ['XListItem', 'XListHead'] } })
    const resolver = granumResolver({ providers: [list] }, { root })
    expect(resolver.resolve('XListItem')).toEqual({ name: 'XListItem', from: '@x/list/components/XListItem' })
    expect(resolver.names()).toEqual(['XList', 'XListHead', 'XListItem'])
    expect([...buildComponentIndex({ providers: [list] }, root, { prefix: 'XListH' }).keys()]).toEqual(['XListHead'])
    // Компонент с тем же именем у другого провайдера первичен.
    const other = makeManifest('@x/other', { XListItem: {} })
    expect(granumResolver({ providers: [list, other] }, { root }).resolve('XListItem')).toEqual({ name: 'XListItem', from: '@x/other/components/XListItem' })
    // Часть с одним именем у двух провайдеров — неоднозначна.
    const twin = makeManifest('@x/twin', { XGrid: { subcomponents: ['XListItem'] } })
    expect(granumResolver({ providers: [list, twin] }, { root }).resolve('XListItem')).toBeUndefined()
  })

  /**
   * Лист приложения объявляет классы, даже если приходит строкой (`?raw`,
   * `?inline`), а не ассетом. CSS-модуль — нет: его классы хешируются, и
   * литерал в разметке с ними не совпадёт.
   */
  it('scanAppSources: классы, объявленные .css-файлами, кроме CSS-модулей', () => {
    const root = mkdtempSync(join(tmpdir(), 'granum-app-css-'))
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/raw.css'), '.raw-b, .raw-a:hover { color: red }\n@media (width > 1px) { .raw-c { color: blue } }\n')
    writeFileSync(join(root, 'src/card.module.css'), '.mod-x { color: red }\n')
    expect(scanAppSources({ dirs: ['src'] }, root, testEngine()).declaredClasses).toEqual(['raw-a', 'raw-b', 'raw-c'])
  })

  it('теги разметки без импорта попадают в селекцию при components: imports', async () => {
    const { root } = appWithManifest()
    writeFileSync(join(root, 'src/App.vue'), '<template>\n  <Panel class="gap-2">\n    <my-widget /><Unknown/>\n  </Panel>\n</template>\n')
    const engine = testEngine()
    const scan = scanAppSources({ dirs: ['src'] }, root, engine)
    expect(scan.componentTags).toEqual(['Panel', 'Unknown'])
    expect(scan.componentImports).toEqual([])
    const app = await prepareTestApp({ providers: ['@x/kit'], components: 'imports', appSources: { dirs: ['src'] } }, root)
    expect(app.resolution.selection.order).toEqual(['@x/kit:Card', '@x/kit:Panel'])
    // `explain` видит те же семена, что и селекция: компонент, выбранный тегом,
    // выбран сам, а не тянется зависимостью без цепочки.
    expect(granumExplain(app, '@x/kit:Panel')).toMatchObject({ reason: 'selected', chain: ['@x/kit:Panel'] })
    expect(granumExplain(app, '@x/kit:Card')).toMatchObject({ reason: 'dependency', chain: ['@x/kit:Panel', '@x/kit:Card'] })
  })

  it('импорты: в селекцию идут только компоненты провайдеров графа, имя со строчной буквы тоже', async () => {
    const root = mkdtempSync(join(tmpdir(), 'granum-imports-'))
    const dist = join(root, 'node_modules/@x/kit/dist')
    mkdirSync(dist, { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'node_modules/@x/kit/package.json'), JSON.stringify({ name: '@x/kit', exports: { './granum.manifest.json': './dist/granum.manifest.json' } }))
    writeFileSync(join(dist, 'granum.manifest.json'), serializeManifest(makeManifest('@x/kit', { Card: {}, button: {} }).manifest))
    // Алиас приложения, чужой пакет со своими `components/` и закомментированный
    // импорт — не granum: селекцию они не трогают и сборку не роняют.
    writeFileSync(join(root, 'src/App.vue'), [
      '<script setup lang="ts">',
      'import AppHeader from \'~/components/AppHeader\'',
      'import { VBtn } from \'vuetify/components/VBtn\'',
      '// import { Card } from \'@x/kit/components/Card\'',
      'import { button } from \'@x/kit/components/button\'',
      '</script>',
      '<template><div/></template>',
      '',
    ].join('\n'))
    const app = await prepareTestApp({ providers: ['@x/kit'], components: 'imports', appSources: { dirs: ['src'] } }, root)
    expect(app.resolution.selection.order).toEqual(['@x/kit:button'])
  })

  it('tagSelection: неоднозначное имя пропускается', () => {
    const a = makeProvider('@x/a', { components: [makeComponent('Card'), makeComponent('Modal')] })
    const b = makeProvider('@x/b', { components: [makeComponent('Card')] })
    expect(tagSelection(['Card', 'Modal', 'Nope'], [a, b])).toEqual(['@x/a:Modal'])
  })

  it('часть составного компонента сводится к владельцу: ownerOf, тег, импорт', () => {
    const list = makeManifest('@x/list', { XList: { subcomponents: ['XListItem'] }, XButton: {} })
    const other = makeManifest('@x/other', { XListItem: {} })
    const node = toProviderNode(list)
    expect(ownerOf(node, 'XListItem')?.name).toBe('XList')
    expect(ownerOf(node, 'XList')?.name).toBe('XList')
    expect(ownerOf(node, 'Nope')).toBeUndefined()
    expect(tagSelection(['XListItem'], [list])).toEqual(['@x/list:XList'])
    // Компонент первичен: имя компонента у одного провайдера и части у другого —
    // компонент. Резолвер авто-импорта знает только компоненты и подставит его.
    expect(tagSelection(['XListItem'], [list, other])).toEqual(['@x/other:XListItem'])
    // Часть с одним именем у двух провайдеров — неоднозначна.
    const twin = makeManifest('@x/twin', { XGrid: { subcomponents: ['XListItem'] } })
    expect(tagSelection(['XListItem'], [list, twin])).toEqual([])
    expect(importSelection(['@x/list:XListItem', '@x/list:Nope'], [node])).toEqual(['@x/list:XList'])
    // Владелец и его часть — один ключ.
    expect(importSelection(['@x/list:XList', '@x/list:XListItem'], [node])).toEqual(['@x/list:XList'])
  })
})

describe('кэши подготовки', () => {
  it('манифест читается один раз, пока файл не изменился', () => {
    const { root, dist } = appWithManifest()
    clearManifestCache()
    const first = loadPackageManifest('@x/kit', root)
    expect(loadPackageManifest('@x/kit', root)).toBe(first)
    const { manifest } = makeManifest('@x/kit', { Card: { classes: ['p-8'] } })
    const file = join(dist, 'granum.manifest.json')
    writeFileSync(file, serializeManifest(manifest))
    const later = new Date(Date.now() + 5000)
    utimesSync(file, later, later)
    const second = loadPackageManifest('@x/kit', root)
    expect(second).not.toBe(first)
    expect(second.manifest.components.Card?.classes).toEqual(['p-8'])
    // require.resolve отдаёт realpath: на macOS /var → /private/var.
    expect(second.baseUrl.endsWith('/node_modules/@x/kit/dist/')).toBe(true)
  })
})
