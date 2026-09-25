/**
 * A-8: резолвер auto-import и селекция по тегам в режиме `'imports'`.
 * A-17: кэш манифестов по stat файла и кэш вывода движка по множеству классов.
 */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEngine } from '../engine/builtin'
import { scanAppSources } from '../node/appSources'
import { clearManifestCache, loadPackageManifest, serializeManifest } from '../node/manifest'
import { prepareApp, tagSelection } from '../node/prepare'
import { buildComponentIndex, granumResolver } from '../vite/resolver'
import { component as makeComponent, makeManifest, makeProvider } from './helpers'

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

describe('granumResolver (A-8)', () => {
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

  it('теги разметки без импорта попадают в селекцию при components: imports', async () => {
    const { root } = appWithManifest()
    writeFileSync(join(root, 'src/App.vue'), '<template>\n  <Panel class="gap-2">\n    <my-widget /><Unknown/>\n  </Panel>\n</template>\n')
    const engine = createEngine()
    const scan = scanAppSources({ dirs: ['src'] }, root, engine)
    expect(scan.componentTags).toEqual(['Panel', 'Unknown'])
    expect(scan.componentImports).toEqual([])
    const app = await prepareApp({ providers: ['@x/kit'], components: 'imports', appSources: { dirs: ['src'] } }, root)
    expect(app.resolution.selection.order).toEqual(['@x/kit:Card', '@x/kit:Panel'])
  })

  it('tagSelection: неоднозначное имя пропускается', () => {
    const a = makeProvider('@x/a', { components: [makeComponent('Card'), makeComponent('Modal')] })
    const b = makeProvider('@x/b', { components: [makeComponent('Card')] })
    expect(tagSelection(['Card', 'Modal', 'Nope'], [a, b])).toEqual(['@x/a:Modal'])
  })
})

describe('кэши подготовки (A-17)', () => {
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

  it('вывод движка для того же множества классов отдаётся из кэша', async () => {
    const engine = createEngine({ preflight: false, extraRules: false })
    const a = await engine.generate({ classes: new Set(['p-4', 'flex']) })
    const b = await engine.generate({ classes: new Set(['flex', 'p-4']) })
    expect(b).toBe(a)
    const c = await engine.generate({ classes: new Set(['flex']) })
    expect(c).not.toBe(a)
    expect(c.css).not.toContain('.p-4')
  })
})
