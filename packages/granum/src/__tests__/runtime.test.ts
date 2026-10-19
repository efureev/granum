import type { GranumThemeManifest, GranumThemeStorage, GranumThemeTarget } from '../runtime'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { resolveGranum } from '../core/resolve'
import { getThemeManifest } from '../node/themeManifest'
import { createCookieStorage, createThemeController, createThemeScript, modeFromCookie, resolveThemeActivation, themeModeValue, themeRootAttributes } from '../runtime'
import { INK, makeManifest, PAPER } from './helpers'

function createTarget(initial?: Record<string, string>): GranumThemeTarget & { attributes: Map<string, string>, writes: number } {
  const attributes = new Map(Object.entries(initial ?? {}))
  const target = {
    attributes,
    writes: 0,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      target.writes++
      attributes.set(name, value)
    },
  }
  return target
}

function memoryStorage(initial: Record<string, string> = {}): GranumThemeStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) }
}

const MANIFEST: GranumThemeManifest = {
  theme: { id: 'ink', title: 'Чернила' },
  modes: [
    { name: 'light', colorScheme: 'light', value: 'ink-light' },
    { name: 'dark', title: 'Тёмный', colorScheme: 'dark', value: 'ink-dark' },
    { name: 'dim', colorScheme: 'dark', value: 'ink-dim' },
  ],
  defaultMode: 'light',
  activation: { attribute: 'data-theme' },
}

describe('getThemeManifest — из той же резолюции, что и CSS (T-4)', () => {
  const owner = makeManifest('@p/ds', {}, {
    theme: {
      defaultTheme: 'paper',
      catalog: {
        paper: { title: 'Бумага', data: 'themes/paper.json', modes: ['light', 'dark'], defaultMode: 'light' },
        ink: { title: 'Чернила', extends: 'paper', data: 'themes/ink.json', modes: ['light', 'dark', 'dim'], defaultMode: 'light' },
      },
      declares: [],
    },
  })
  const resolve = (input: Partial<Parameters<typeof resolveGranum>[0]> = {}) =>
    resolveGranum({ providers: [owner], themeData: { '@p/ds': { paper: PAPER, ink: { ...INK, extensions: { granularity: { componentDefaults: { Button: { size: 'm' } } } } } } }, ...input })

  it('тема, режимы с парами, атрибут, extensions как есть', () => {
    const manifest = getThemeManifest(resolve({ theme: 'ink', modes: { define: { sepia: { extends: 'light', title: 'Сепия' } } } }))
    expect(manifest.theme).toEqual({ id: 'ink', title: 'Чернила' })
    expect(manifest.modes.map(m => `${m.name}:${m.value}:${m.colorScheme}`)).toEqual(['light:ink-light:light', 'dark:ink-dark:dark', 'dim:ink-dim:dark', 'sepia:ink-sepia:light'])
    expect(manifest.modes[3]!.title).toBe('Сепия')
    expect(manifest.defaultMode).toBe('light')
    expect(manifest.activation).toEqual({ attribute: 'data-theme', value: '{theme}-{mode}' })
    expect(manifest.previews).toBeUndefined()
    expect(manifest.extensions).toEqual({ granularity: { componentDefaults: { Button: { size: 'm' } } } })
  })

  it('превью — темы с парами по шаблону сборки', () => {
    const manifest = getThemeManifest(resolve({ theme: 'ink', previews: ['paper'], modes: { activation: { attribute: 'data-look', value: '{mode}@{theme}' } } }))
    expect(manifest.activation).toEqual({ attribute: 'data-look', value: '{mode}@{theme}' })
    expect(manifest.previews).toEqual([{ theme: { id: 'paper', title: 'Бумага' }, modes: [
      { name: 'light', colorScheme: 'light', value: 'light@paper' },
      { name: 'dark', colorScheme: 'dark', value: 'dark@paper' },
    ] }])
    expect(themeModeValue(manifest, 'dark', 'paper')).toBe('dark@paper')
    expect(themeModeValue(manifest, 'dim')).toBe('dim@ink')
  })

  it('от селекции компонентов не зависит', () => {
    expect(getThemeManifest(resolve({ components: [] }))).toEqual(getThemeManifest(resolve()))
  })

  it('без тем — режимов нет', () => {
    const manifest = getThemeManifest(resolveGranum({ providers: [makeManifest('@p/plain', { X: {} })] }))
    expect(manifest.modes).toEqual([])
  })
})

describe('resolveThemeActivation — пара обратно в режим (RT-5)', () => {
  it('известная пара — режим, чужая или пустая — undefined', () => {
    expect(resolveThemeActivation(MANIFEST, 'ink-dim')?.name).toBe('dim')
    expect(resolveThemeActivation(MANIFEST, 'paper-dark')).toBeUndefined()
    expect(resolveThemeActivation(MANIFEST, null)).toBeUndefined()
  })
})

describe('themeModeValue — пара для острова или превью', () => {
  it('режим активной темы; темы и режима вне сборки — undefined', () => {
    expect(themeModeValue(MANIFEST, 'dim')).toBe('ink-dim')
    expect(themeModeValue(MANIFEST, 'sepia')).toBeUndefined()
    expect(themeModeValue(MANIFEST, 'dark', 'paper')).toBeUndefined()
  })
})

describe('createThemeController (RT-1)', () => {
  it('режим по умолчанию, переключение, хранение имени режима, cycle и подписки', () => {
    const target = createTarget()
    const storage = memoryStorage()
    const themes = createThemeController(MANIFEST, { target, storage, prefersDark: () => false })
    expect(themes.mode).toBe('light')
    expect(themes.theme).toEqual({ id: 'ink', title: 'Чернила' })
    expect(target.attributes.get('data-theme')).toBe('ink-light')
    const seen: string[] = []
    const stop = themes.subscribe(mode => seen.push(mode))
    themes.setMode('dim')
    expect(target.attributes.get('data-theme')).toBe('ink-dim')
    expect(storage.data.get('granum-theme')).toBe('dim')
    expect(themes.cycle()).toBe('light')
    stop()
    themes.setMode('dark')
    expect(seen).toEqual(['dim', 'light'])
    expect(themes.modes().map(m => m.name)).toEqual(['light', 'dark', 'dim'])
  })

  it('auto: сохранённый режим → системная схема → режим по умолчанию', () => {
    expect(createThemeController(MANIFEST, { target: createTarget(), storage: memoryStorage({ 'granum-theme': 'dim' }) }).mode).toBe('dim')
    expect(createThemeController(MANIFEST, { target: createTarget(), storage: memoryStorage({ 'granum-theme': 'gone' }), prefersDark: () => true }).mode).toBe('dark')
    expect(createThemeController(MANIFEST, { target: createTarget(), storage: null, prefersDark: () => false }).mode).toBe('light')
    expect(createThemeController(MANIFEST, { target: createTarget(), storage: null, initial: 'dim' }).mode).toBe('dim')
  })

  it('поверх уже выставленной пары: режим узнан, корень не тронут (RT-5)', () => {
    const target = createTarget({ 'data-theme': 'ink-dark' })
    const themes = createThemeController(MANIFEST, { target, storage: memoryStorage({ 'granum-theme': 'dim' }) })
    expect(themes.mode).toBe('dark')
    expect(target.writes).toBe(0)
  })

  it('setMode с persist: false применяет режим, но выбор не запоминает', () => {
    const target = createTarget()
    const storage = memoryStorage({ 'granum-theme': 'dim' })
    const themes = createThemeController(MANIFEST, { target, storage, initial: 'light' })
    themes.setMode('dark', { persist: false })
    expect(themes.mode).toBe('dark')
    expect(target.attributes.get('data-theme')).toBe('ink-dark')
    expect(storage.data.get('granum-theme')).toBe('dim')
  })

  it('хранилище, бросающее на чтении и записи, не роняет контроллер', () => {
    const storage: GranumThemeStorage = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
    }
    const themes = createThemeController(MANIFEST, { target: createTarget(), storage, prefersDark: () => true })
    expect(themes.mode).toBe('dark')
    themes.setMode('dim')
    expect(themes.mode).toBe('dim')
  })

  it('ошибки: неизвестный режим, пустой манифест', () => {
    const themes = createThemeController(MANIFEST, { target: createTarget(), storage: null })
    expect(() => themes.setMode('sepia')).toThrow(/mode 'sepia' is not in the build of theme 'ink'/)
    expect(() => createThemeController({ ...MANIFEST, modes: [] })).toThrow(/no modes/)
  })

  it('без DOM контроллер работает и ничего не применяет', () => {
    vi.stubGlobal('document', undefined)
    try {
      const themes = createThemeController(MANIFEST, { storage: null, prefersDark: () => true })
      expect(themes.mode).toBe('dark')
      themes.setMode('light')
      expect(themes.mode).toBe('light')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('createThemeScript (RT-3)', () => {
  function runScript(html: string, env: { attribute?: string, stored?: string, cookie?: string, dark?: boolean } = {}): string | undefined {
    const attributes = new Map<string, string>(env.attribute ? [['data-theme', env.attribute]] : [])
    const body = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)![1]!
    runInNewContext(body, {
      document: {
        documentElement: { getAttribute: (n: string) => attributes.get(n) ?? null, setAttribute: (n: string, v: string) => void attributes.set(n, v) },
        cookie: env.cookie ?? '',
      },
      localStorage: { getItem: () => env.stored ?? null },
      window: { matchMedia: true },
      matchMedia: () => ({ matches: env.dark === true }),
    })
    return attributes.get('data-theme')
  }

  it('сохранённый режим, иначе системная схема, иначе режим по умолчанию', () => {
    const script = createThemeScript({ manifest: MANIFEST })
    expect(runScript(script, { stored: 'dim' })).toBe('ink-dim')
    expect(runScript(script, { stored: 'nope', dark: true })).toBe('ink-dark')
    expect(runScript(script)).toBe('ink-light')
  })

  it('пара от сервера не трогается; cookie раньше localStorage', () => {
    expect(runScript(createThemeScript({ manifest: MANIFEST }), { attribute: 'ink-dim', stored: 'light' })).toBe('ink-dim')
    expect(runScript(createThemeScript({ manifest: MANIFEST, cookie: 'mode' }), { cookie: 'a=1; mode=dark', stored: 'light' })).toBe('ink-dark')
  })

  it('nonce в теге; закрывающий тег в данных не ломает скрипт', () => {
    const script = createThemeScript({ manifest: { ...MANIFEST, theme: { id: 'ink', title: '</script>' } }, nonce: 'abc"' })
    expect(script.startsWith('<script nonce="abc&quot;">')).toBe(true)
    expect(script.match(/<\/script>/g)).toHaveLength(1)
  })
})

describe('cookie для SSR (RT-4)', () => {
  it('хранилище пишет и читает режим; сервер находит его в заголовке', () => {
    const doc = { cookie: '' }
    const storage = createCookieStorage({ name: 'mode', document: doc })
    storage.setItem('ignored', 'dim')
    expect(doc.cookie).toMatch(/^mode=dim; Max-Age=\d+; Path=\/; SameSite=lax$/)
    expect(createCookieStorage({ name: 'mode', document: { cookie: 'x=1; mode=dark' } }).getItem('mode')).toBe('dark')
    expect(modeFromCookie(MANIFEST, 'x=1; granum-theme=dim')?.value).toBe('ink-dim')
    expect(modeFromCookie(MANIFEST, 'granum-theme=sepia')).toBeUndefined()
    expect(themeRootAttributes(MANIFEST, 'dark')).toEqual({ 'data-theme': 'ink-dark' })
    expect(themeRootAttributes(MANIFEST)).toEqual({ 'data-theme': 'ink-light' })
  })
})
