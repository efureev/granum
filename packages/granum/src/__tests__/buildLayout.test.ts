import { describe, expect, it } from 'vitest'
import { classifyModule, classifyOutputFile, collectComponentSources, granumAssetFileNames, granumChunkFileNames } from '../build/layout'
import { defineGranumComponent } from '../contract'

const root = 'file:///pkg/src/components'
const components = [
  defineGranumComponent(`${root}/XTest1/config.ts`, { name: 'XTest1' }),
  defineGranumComponent(`${root}/groupA/XGroupAOne/config.ts`, { name: 'XGroupAOne', group: 'groupA' }),
  defineGranumComponent(`${root}/groupA/XGroupATwo/config.ts`, { name: 'XGroupATwo', group: 'groupA' }),
  defineGranumComponent(`${root}/reverses/XNestedReverse/config.ts`, { name: 'XNestedReverse' }),
]
const sources = collectComponentSources(components)

describe('collectComponentSources / classifyModule', () => {
  it('директории берутся из sourceUrl; групповая раскладка распознаётся', () => {
    expect(sources.map(s => s.name).sort()).toEqual(['XGroupAOne', 'XGroupATwo', 'XNestedReverse', 'XTest1'])
    expect(sources.find(s => s.name === 'XGroupAOne')!.sharedDir).toBe('/pkg/src/components/groupA/shared')
    expect(sources.find(s => s.name === 'XTest1')!.sharedDir).toBeNull()
    expect(classifyModule('/pkg/src/components/XTest1/XTest1.vue', sources)).toEqual({ kind: 'component', name: 'XTest1' })
    expect(classifyModule('/pkg/src/components/reverses/XNestedReverse/parts/Header.vue?vue&type=style', sources)).toEqual({ kind: 'component', name: 'XNestedReverse' })
    expect(classifyModule('/pkg/src/components/groupA/shared/Shared.vue', sources)).toEqual({ kind: 'group', group: 'groupA' })
    expect(classifyModule('/pkg/src/utils/x.ts', sources)).toEqual({ kind: 'shared' })
    expect(classifyModule('/pkg/src/components/XTest1Extra/x.ts', sources)).toEqual({ kind: 'shared' })
  })

  it('дескриптор без sourceUrl пропускается', () => {
    expect(collectComponentSources([{ name: 'Bare' }])).toEqual([])
  })
})

describe('granumChunkFileNames (INV-LAY-1, INV-LAY-4)', () => {
  const chunk = granumChunkFileNames(sources)

  it('sfc компонента → его директория; общий sfc группы → groups/; прочее → chunks/', () => {
    expect(chunk({ moduleIds: ['/pkg/src/components/XTest1/XTest1.vue'] })).toBe('components/XTest1/chunks/[name]-[hash].js')
    expect(chunk({ moduleIds: ['/pkg/src/components/groupA/shared/Shared.vue', '/pkg/src/components/groupA/XGroupAOne/X.vue'] })).toBe('groups/groupA/shared/[name]-[hash].js')
    expect(chunk({ moduleIds: ['/pkg/src/utils/overlayZ.ts'] })).toBe('chunks/[name]-[hash].js')
    expect(chunk({})).toBe('chunks/[name]-[hash].js')
  })
})

describe('granumAssetFileNames (B-3)', () => {
  const assets = granumAssetFileNames(sources)

  it('css компонента по исходному файлу или имени → components/<Name>/styles.css', () => {
    expect(assets({ names: ['index.css'], originalFileNames: ['/pkg/src/components/XTest1/XTest1.vue'] })).toBe('components/XTest1/styles.css')
    expect(assets({ name: 'XGroupATwo.css' })).toBe('components/XGroupATwo/styles.css')
    expect(assets({ name: 'index.css' })).toBe('[name]-[hash][extname]')
    expect(assets({ name: 'logo.svg' })).toBe('[name]-[hash][extname]')
    expect(assets({})).toBe('[name]-[hash][extname]')
  })
})

describe('classifyOutputFile', () => {
  it('по пути в dist', () => {
    expect(classifyOutputFile('components/XhCard/index.js')).toEqual({ kind: 'component', name: 'XhCard' })
    expect(classifyOutputFile('groups/data/shared/Header-abc.js')).toEqual({ kind: 'group', group: 'data' })
    expect(classifyOutputFile('chunks/overlayZ-abc.js')).toEqual({ kind: 'shared' })
  })
})
