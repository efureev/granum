import type { GranumAppTheme, ResolveThemesInput } from '../core/resolveThemes'
import { describe, expect, it } from 'vitest'
import { toProviderNode } from '../core/providerNode'
import { resolveThemes } from '../core/resolveThemes'
import { makeManifest, makeProvider, themeData } from './helpers'

const OWNER = '@acme/tokens'
const owner = makeManifest(OWNER, {}, {
  version: '2.0.0',
  theme: { catalog: { stone: { title: 'Камень', data: 'themes/stone.json', modes: ['light'], defaultMode: 'light' } }, declares: [] },
})
const ui = makeManifest('@acme/ui', {}, { version: '1.4.0' })
const charts = makeManifest('@acme/charts', {}, { version: '3.0.0-rc.1' })
const objectPkg = makeProvider('@acme/object')

const STONE = themeData('stone', { light: { 'gr-bg': '#fff' } }, {
  version: '1.0.0',
  targets: {
    '@acme/ui': '^1.2.0',
    '@acme/charts': '^2.0.0',
    '@acme/object': '^1.0.0',
    '@acme/absent': '^1.0.0',
  },
})

function resolve(themes: ResolveThemesInput['themes'] = ['stone']) {
  return resolveThemes([owner, ui, charts, objectPkg].map(toProviderNode), { themes }, [], { [OWNER]: { stone: STONE } })
}

describe('целевые пакеты темы (A-38, INV-THEME-12)', () => {
  it('исход по каждому пакету: в диапазоне, вне его, пакета нет, версия неизвестна', () => {
    expect(resolve().default!.theme.targets).toEqual([
      { providerId: '@acme/ui', range: '^1.2.0', version: '1.4.0', status: 'match' },
      { providerId: '@acme/charts', range: '^2.0.0', version: '3.0.0-rc.1', status: 'mismatch' },
      { providerId: '@acme/object', range: '^1.0.0', status: 'unknown-version' },
      { providerId: '@acme/absent', range: '^1.0.0', status: 'absent' },
    ])
  })

  it('просканированный объектный провайдер версии не знает: его 0.0.0 — заглушка, сверки нет', () => {
    const scanned = makeManifest('@acme/ui', {}, { version: '0.0.0' })
    const withWarning = { ...scanned, manifest: { ...scanned.manifest, warnings: [{ code: 'scanned-provider' }] } }
    const nodes = [owner, withWarning].map(toProviderNode)
    expect(nodes[1]!.version).toBeUndefined()
    const r = resolveThemes(nodes, { themes: ['stone'] }, [], { [OWNER]: { stone: STONE } })
    expect(r.default!.theme.targets.find(t => t.providerId === '@acme/ui')).toEqual({ providerId: '@acme/ui', range: '^1.2.0', status: 'unknown-version' })
    expect(r.warnings.filter(w => w.kind === 'theme-target-mismatch')).toEqual([])
  })

  it('сборочные метаданные версии пакета в сверке не участвуют', () => {
    const built = makeManifest('@acme/ui', {}, { version: '1.4.0+sha.5114f85' })
    const r = resolveThemes([owner, built].map(toProviderNode), { themes: ['stone'] }, [], { [OWNER]: { stone: STONE } })
    expect(r.default!.theme.targets.find(t => t.providerId === '@acme/ui')?.status).toBe('match')
  })

  it('предупреждение — только на выход за диапазон', () => {
    expect(resolve().warnings).toEqual([
      { kind: 'theme-target-mismatch', theme: 'stone', providerId: '@acme/charts', range: '^2.0.0', version: '3.0.0-rc.1' },
    ])
  })

  it('тема-объект сверяется так же; тема без targets — пусто', () => {
    const brand: GranumAppTheme = themeData('brand', { light: { 'gr-bg': '#000' } }, { targets: { '@acme/ui': '>=2.0.0' } })
    const r = resolve([{ theme: 'stone', default: true }, brand])
    expect(r.themes[1]!.theme.targets).toEqual([{ providerId: '@acme/ui', range: '>=2.0.0', version: '1.4.0', status: 'mismatch' }])
    expect(r.warnings.filter(w => w.kind === 'theme-target-mismatch').map(w => w.theme)).toEqual(['stone', 'brand'])
    const plain: GranumAppTheme = themeData('plain', { light: { 'gr-bg': '#000' } })
    expect(resolve([plain]).default!.theme.targets).toEqual([])
  })
})
