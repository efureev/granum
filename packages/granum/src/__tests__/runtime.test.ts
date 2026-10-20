import type { GranumThemeManifest, GranumThemeStorage, GranumThemeTarget } from '../runtime'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { resolveGranum } from '../core/resolve'
import { getThemeManifest } from '../node/themeManifest'
import { createCookieStorage, createThemeController, createThemeManifest, createThemeScript, createThemeScriptCode, modeFromCookie, resolveThemeActivation, themeModeValue, themeRootAttributes } from '../runtime'
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

describe('getThemeManifest — из той же резолюции, что и CSS', () => {
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
    resolveGranum({ providers: [owner], themeData: { '@p/ds': { paper: { ...PAPER, extensions: { granularity: { componentDefaults: { Button: { size: 's' } } } } }, ink: { ...INK, extensions: { granularity: { componentDefaults: { Button: { size: 'm' } } } } } } }, ...input })

  it('тема, режимы с парами, атрибут, extensions как есть', () => {
    const manifest = getThemeManifest(resolve({ theme: 'ink', modes: { names: ['light', 'dark', 'dim', 'sepia'], define: { sepia: { extends: 'light', title: 'Сепия' } } } }))
    expect(manifest.theme).toEqual({ id: 'ink', title: 'Чернила' })
    expect(manifest.modes.map(m => `${m.name}:${m.value}:${m.colorScheme}`)).toEqual(['light:ink-light:light', 'dark:ink-dark:dark', 'dim:ink-dim:dark', 'sepia:ink-sepia:light'])
    expect(manifest.modes[3]!.title).toBe('Сепия')
    expect(manifest.defaultMode).toBe('light')
    expect(manifest.activation).toEqual({ attribute: 'data-theme', value: '{theme}-{mode}' })
    expect(manifest.previews).toBeUndefined()
    expect(manifest.extensions).toEqual({ granularity: { componentDefaults: { Button: { size: 'm' } } } })
  })

  it('превью — темы с парами по шаблону сборки', () => {
    const manifest = getThemeManifest(resolve({ theme: 'ink', previews: ['paper'], modes: { names: ['light', 'dim'], activation: { attribute: 'data-look', value: '{mode}@{theme}' } } }))
    expect(manifest.activation).toEqual({ attribute: 'data-look', value: '{mode}@{theme}' })
    expect(manifest.previews).toEqual([{ theme: { id: 'paper', title: 'Бумага' }, modes: [
      { name: 'light', colorScheme: 'light', value: 'light@paper' },
      { name: 'dark', colorScheme: 'dark', value: 'dark@paper' },
    ], extensions: { granularity: { componentDefaults: { Button: { size: 's' } } } } }])
    expect(themeModeValue(manifest, 'dark', 'paper')).toBe('dark@paper')
    expect(themeModeValue(manifest, 'dim')).toBe('dim@ink')
  })

  it('createThemeManifest по описанию темы совпадает с манифестом сборки', () => {
    const built = getThemeManifest(resolve({ theme: 'ink', modes: { names: ['dim', 'light', 'dark'] } }))
    const made = createThemeManifest({
      theme: { id: 'ink', title: 'Чернила' },
      modes: [{ name: 'dim', colorScheme: 'dark' }, { name: 'light', colorScheme: 'light' }, { name: 'dark', title: 'Тёмный', colorScheme: 'dark' }],
      defaultMode: 'light',
    })
    expect(made.modes.map(m => m.name)).toEqual(['light', 'dim', 'dark'])
    expect(made.modes.map(m => m.value)).toEqual(built.modes.map(m => m.value))
    expect(made.activation).toEqual(built.activation)
    expect(createThemeManifest({ ...made, modes: made.modes, activation: { value: '{mode}@{theme}' } }).modes[0]!.value).toBe('light@ink')
    expect(() => createThemeManifest({ ...made, defaultMode: 'sepia' })).toThrow(/default mode 'sepia'/)
  })

  it('от селекции компонентов не зависит', () => {
    expect(getThemeManifest(resolve({ components: [] }))).toEqual(getThemeManifest(resolve()))
  })

  it('без тем — режимов нет', () => {
    const manifest = getThemeManifest(resolveGranum({ providers: [makeManifest('@p/plain', { X: {} })] }))
    expect(manifest.modes).toEqual([])
  })
})

describe('resolveThemeActivation — пара обратно в режим', () => {
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

describe('createThemeController', () => {
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

  it('поверх уже выставленной пары: режим узнан, корень не тронут', () => {
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

describe('createThemeScript', () => {
  interface ScriptEnv { attribute?: string | undefined, stored?: string | null, cookie?: string, dark?: boolean, noMatchMedia?: boolean, storageThrows?: boolean }

  function runCode(code: string, env: ScriptEnv = {}): { attribute: string | undefined, listeners: Map<string, () => void> } {
    const attributes = new Map<string, string>(env.attribute ? [['data-theme', env.attribute]] : [])
    const listeners = new Map<string, () => void>()
    const matchMedia = env.noMatchMedia ? undefined : () => ({ matches: env.dark === true })
    runInNewContext(code, {
      document: {
        documentElement: { getAttribute: (n: string) => attributes.get(n) ?? null, setAttribute: (n: string, v: string) => void attributes.set(n, v) },
        cookie: env.cookie ?? '',
        addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
      },
      localStorage: {
        getItem: () => {
          if (env.storageThrows)
            throw new Error('SecurityError')
          return env.stored ?? null
        },
      },
      window: { matchMedia },
      matchMedia,
    })
    return { attribute: attributes.get('data-theme'), listeners }
  }

  function runScript(html: string, env: ScriptEnv = {}): string | undefined {
    return runCode(/<script[^>]*>([\s\S]*)<\/script>/.exec(html)![1]!, env).attribute
  }

  /** Что выберет контроллер с `initial: 'auto'` на тех же входах. */
  function controllerPair(manifest: GranumThemeManifest, env: ScriptEnv): string | undefined {
    const target = createTarget(env.attribute ? { 'data-theme': env.attribute } : {})
    createThemeController(manifest, { target, storage: memoryStorage(env.stored ? { 'granum-theme': env.stored } : {}), prefersDark: () => env.dark === true })
    return target.attributes.get('data-theme')
  }

  it('выбирает ту же пару, что контроллер, во всех сочетаниях входов', () => {
    const darkDefault: GranumThemeManifest = { ...MANIFEST, modes: [MANIFEST.modes[2]!, MANIFEST.modes[0]!], defaultMode: 'dim' }
    const single: GranumThemeManifest = { ...MANIFEST, modes: [MANIFEST.modes[1]!], defaultMode: 'dark' }
    for (const manifest of [MANIFEST, darkDefault, single]) {
      const code = createThemeScriptCode({ manifest })
      for (const attribute of [undefined, 'ink-dim', 'ink-light', 'paper-dark']) {
        for (const stored of [null, 'light', 'dark', 'dim', 'nope', '', 'constructor', 'toString']) {
          for (const dark of [true, false]) {
            const env = { attribute, stored, dark }
            expect(runCode(code, env).attribute, `${manifest.defaultMode} ${JSON.stringify(env)}`).toBe(controllerPair(manifest, env))
          }
        }
      }
    }
  })

  it('пара от сервера не трогается; cookie раньше localStorage', () => {
    expect(runScript(createThemeScript({ manifest: MANIFEST }), { attribute: 'ink-dim', stored: 'light' })).toBe('ink-dim')
    const withCookie = createThemeScript({ manifest: MANIFEST, cookie: 'gr.mode' })
    expect(runScript(withCookie, { cookie: 'a=1; gr.mode=dark', stored: 'light' })).toBe('ink-dark')
    expect(runScript(withCookie, { cookie: 'grXmode=dark', stored: 'dim' })).toBe('ink-dim')
    expect(runScript(withCookie, { cookie: 'gr.mode=nope', stored: 'dim' })).toBe('ink-dim')
    // Без `cookie` чужая cookie с именем ключа выбор не перебивает.
    expect(runScript(createThemeScript({ manifest: MANIFEST }), { cookie: 'granum-theme=dark', stored: 'light' })).toBe('ink-light')
  })

  it('ничего не бросает наружу: без DOM, без matchMedia, с бросающим хранилищем', () => {
    const code = createThemeScriptCode({ manifest: MANIFEST, cookie: 'mode', reapplyOn: ['astro:after-swap'] })
    expect(() => runInNewContext(code, {})).not.toThrow()
    expect(runCode(code, { noMatchMedia: true }).attribute).toBe('ink-light')
    expect(runCode(code, { storageThrows: true, dark: true }).attribute).toBe('ink-dark')
  })

  it('reapplyOn: пара ставится заново после подмены документа', () => {
    const attributes = new Map<string, string>()
    const listeners: Array<[string, () => void]> = []
    const document = {
      documentElement: { getAttribute: (n: string) => attributes.get(n) ?? null, setAttribute: (n: string, v: string) => void attributes.set(n, v) },
      cookie: '',
      addEventListener: (type: string, fn: () => void) => {
        // Как у браузера: та же функция на то же событие второй раз не подписывается.
        if (!listeners.some(([t, f]) => t === type && f === fn))
          listeners.push([type, fn])
      },
    }
    runInNewContext(createThemeScriptCode({ manifest: MANIFEST, reapplyOn: ['astro:after-swap'] }), { document, localStorage: { getItem: () => 'dim' }, window: {} })
    expect(attributes.get('data-theme')).toBe('ink-dim')
    attributes.clear()
    listeners.forEach(([, fn]) => fn())
    listeners.forEach(([, fn]) => fn())
    expect(attributes.get('data-theme')).toBe('ink-dim')
    expect(listeners.map(([type]) => type)).toEqual(['astro:after-swap'])
  })

  it('код собран под манифест: без cookie и с одной схемой лишних веток нет', () => {
    const code = createThemeScriptCode({ manifest: MANIFEST })
    expect(code).not.toContain('cookie')
    expect(code).not.toContain('addEventListener')
    expect(code).toContain('m={light:"ink-light",dark:"ink-dark",dim:"ink-dim"}')
    expect(createThemeScriptCode({ manifest: { ...MANIFEST, modes: [MANIFEST.modes[0]!] } })).not.toContain('matchMedia')
  })

  it('укладывается в 512 Б на теме из двух режимов — даже с cookie и повтором по событию', () => {
    const slate: GranumThemeManifest = {
      theme: { id: 'slate', title: 'Slate' },
      modes: [{ name: 'light', colorScheme: 'light', value: 'slate-light' }, { name: 'dark', colorScheme: 'dark', value: 'slate-dark' }],
      defaultMode: 'light',
      activation: { attribute: 'data-theme' },
    }
    const code = createThemeScriptCode({ manifest: slate, storageKey: 'gr-theme', cookie: 'gr-theme', reapplyOn: ['astro:after-swap'] })
    expect(new TextEncoder().encode(code).length).toBeLessThanOrEqual(512)
  })

  it('nonce в теге; закрывающий тег в данных не ломает скрипт; плохое имя cookie и пустой манифест — ошибка', () => {
    const script = createThemeScript({ manifest: { ...MANIFEST, activation: { attribute: 'data-theme' }, modes: [{ ...MANIFEST.modes[0]!, value: '</script>' }] }, nonce: 'abc"' })
    expect(script.startsWith('<script nonce="abc&quot;">')).toBe(true)
    expect(script.match(/<\/script>/g)).toHaveLength(1)
    expect(() => createThemeScript({ manifest: MANIFEST, cookie: 'a;b' })).toThrow(/cookie token/)
    expect(() => createThemeScript({ manifest: MANIFEST, cookie: '</script>' })).toThrow(/cookie token/)
    expect(() => createThemeScript({ manifest: { ...MANIFEST, modes: [] } })).toThrow(/no modes/)
  })
})

describe('cookie для SSR', () => {
  it('cookie с SameSite=None пишется с Secure — без него браузер её отклоняет', () => {
    const written = (options: Parameters<typeof createCookieStorage>[0]): string => {
      const doc = { cookie: '' }
      createCookieStorage({ ...options, document: doc }).setItem('ignored', 'dark')
      return doc.cookie
    }
    expect(written({ sameSite: 'none' })).toMatch(/; SameSite=none; Secure$/)
    expect(written({ secure: true })).toMatch(/; SameSite=lax; Secure$/)
    expect(written({})).not.toContain('Secure')
    expect(() => createCookieStorage({ sameSite: 'none', secure: false })).toThrow(/SameSite=None requires Secure/)
  })

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
