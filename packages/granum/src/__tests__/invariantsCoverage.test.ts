/**
 * Точечные проверки инвариантов, у которых нет своего модуля-владельца в
 * тестах: INV-CON-8, INV-CSS-7, INV-MAN-8.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { collectDonorIds, findMissingPeers } from '../build/peers'
import { resolveGranum } from '../core/resolve'
import { createEngine } from '../engine/builtin'
import { emitCss } from '../node/emit'
import { prepareApp } from '../node/prepare'
import { component, makeManifest, makeProvider } from './helpers'

describe('инвариант INV-CON-8: зависимость провайдера не выбирает компоненты донора', () => {
  it('в селекции только явно выбранный компонент', () => {
    const donor = makeProvider('@x/base', { components: [component('XBox'), component('XIcon')] })
    const consumer = makeProvider('@x/ui', { components: [component('Card')], dependencies: [donor] })
    const resolution = resolveGranum({ providers: [consumer], components: ['@x/ui:Card'] })
    expect(resolution.providers.map(p => p.id)).toEqual(['@x/base', '@x/ui'])
    expect(resolution.selection.order).toEqual(['@x/ui:Card'])
  })
})

describe('инвариант INV-CON-9: кросс-провайдерный донор перечислен в peerDependencies', () => {
  it('доноры собираются из зависимостей провайдера и компонентов; peer-missing — по package.json', () => {
    const donor = makeProvider('@x/base')
    const provider = makeProvider('@x/ui', {
      components: [component('Card', { dependencies: ['@x/icons:XIcon', { provider: '@x/base', components: ['XBox'] }, 'Panel'] }), component('Panel')],
      dependencies: [donor, '@x/theme'],
    })
    expect(collectDonorIds(provider)).toEqual(['@x/base', '@x/icons', '@x/theme'])
    expect(findMissingPeers(provider, { peerDependencies: { '@x/base': '^1', 'vue': '^3' }, dependencies: { '@x/theme': '^1' } })).toEqual(['@x/icons'])
    expect(findMissingPeers(makeProvider('@x/solo'), {})).toEqual([])
  })
})

describe('инвариант INV-CSS-7: одно правило эмитируется один раз', () => {
  it('класс из нескольких источников даёт один селектор', async () => {
    const engine = createEngine({ preflight: false, extraRules: false })
    const out = await engine.generate({ classes: new Set(['p-4', 'p-4', 'flex']) })
    expect(out.css.match(/\.p-4\{/g)).toHaveLength(1)
    expect(out.matched.size).toBe(2)
  })
})

describe('инвариант INV-MAN-8: приложение не читает JS провайдера ради резолюции', () => {
  it('cSS одинаков при настоящих и пустых JS-файлах провайдера', async () => {
    const root = mkdtempSync(join(tmpdir(), 'granum-man8-'))
    const dist = join(root, 'node_modules/@x/kit/dist')
    mkdirSync(join(dist, 'components/Card'), { recursive: true })
    writeFileSync(join(dist, 'components/Card/styles.css'), '.card{padding:var(--space)}\n')
    const js = join(dist, 'components/Card/index.js')
    writeFileSync(js, 'export const Card = { classes: "p-9 m-9" }\n')
    const loaded = makeManifest('@x/kit', { Card: { classes: ['p-4'], css: ['components/Card/styles.css'] } })
    const provider = { manifest: loaded.manifest, baseUrl: `${pathToFileURL(dist).href}/` }
    const build = async () => (await emitCss(await prepareApp({ providers: [provider], components: ['@x/kit:Card'] }, root))).css
    const withJs = await build()
    writeFileSync(js, '')
    const withoutJs = await build()
    expect(withoutJs).toBe(withJs)
    expect(withJs).toContain('.p-4{')
    expect(withJs).not.toContain('.p-9{')
  })
})
