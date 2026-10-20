import type { GranumSheetDocument, GranumThemeManifest, GranumThemeStorage, GranumThemeTarget } from '../runtime'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { resolveGranum } from '../core/resolve'
import { getThemeManifest } from '../node/themeManifest'
import {
  carryThemeMode,
  createCookieStorage,
  createThemeController,
  createThemeManifest,
  createThemeScript,
  createThemeScriptCode,
  isSelectableTheme,
  loadThemeSheet,
  readThemeSelection,
  resolveThemeActivation,
  themeFromCookie,
  themeModeValue,
  themeRootAttributes,
  themeSelectionKey,
  themeSheetLink,
} from '../runtime'
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

/** Ссылка на лист в документе-заглушке: грузится, когда велят. */
class FakeLink {
  rel = ''
  href = ''
  sheet: unknown = null
  /** Список ссылок документа, в который ссылку вставили. */
  owner: FakeLink[] | undefined
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, (() => void)[]>()
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  remove(): void {
    this.owner?.splice(this.owner.indexOf(this), 1)
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  finish(type: 'load' | 'error'): void {
    if (type === 'load')
      this.sheet = {}
    for (const listener of this.listeners.get(type) ?? [])
      listener()
  }
}

/** Документ-заглушка для листов тем: `auto` — грузить сразу, `fail` — ошибкой. */
function fakeDocument(mode: 'auto' | 'manual' | 'fail' = 'auto'): GranumSheetDocument & { links: FakeLink[] } {
  const links: FakeLink[] = []
  return {
    links,
    head: {
      appendChild: (node: never) => {
        const link = node as FakeLink
        link.owner = links
        links.push(link)
        if (mode !== 'manual')
          queueMicrotask(() => link.finish(mode === 'fail' ? 'error' : 'load'))
      },
    },
    createElement: () => new FakeLink(),
    querySelector: (selector: string) => links.find(link => selector === `link[data-granum-theme="${link.attributes.get('data-granum-theme')}"]`) ?? null,
  }
}

const INK_THEME = {
  id: 'ink',
  title: 'Чернила',
  modes: [
    { name: 'light', colorScheme: 'light' as const, value: 'ink-light' },
    { name: 'dark', title: 'Тёмный', colorScheme: 'dark' as const, value: 'ink-dark' },
    { name: 'dim', colorScheme: 'dark' as const, value: 'ink-dim' },
  ],
  defaultMode: 'light',
}

const MANIFEST: GranumThemeManifest = {
  themes: [INK_THEME],
  defaultTheme: 'ink',
  activation: { attribute: 'data-theme' },
}

/** Основная `ink` и дополнительная `paper` со своим листом. */
const TWO: GranumThemeManifest = {
  themes: [
    INK_THEME,
    {
      id: 'paper',
      title: 'Бумага',
      modes: [{ name: 'light', colorScheme: 'light', value: 'paper-light' }, { name: 'dark', colorScheme: 'dark', value: 'paper-dark' }],
      defaultMode: 'light',
      href: '/assets/granum-theme-paper-x1.css',
    },
  ],
  defaultTheme: 'ink',
  activation: { attribute: 'data-theme' },
}

/** Тема без адреса листа — как в манифесте, собранном до сборки. */
function withoutHref(theme: GranumThemeManifest['themes'][number]): GranumThemeManifest['themes'][number] {
  const { href: _href, ...rest } = theme
  return rest
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

  it('темы с режимами и парами, основная, атрибут, extensions как есть', () => {
    const manifest = getThemeManifest(resolve({ themes: [{ theme: 'ink', modes: { names: ['light', 'dark', 'dim', 'sepia'], define: { sepia: { extends: 'light', title: 'Сепия' } } } }] }))
    expect(manifest.defaultTheme).toBe('ink')
    expect(manifest.themes).toHaveLength(1)
    const ink = manifest.themes[0]!
    expect(ink.id).toBe('ink')
    expect(ink.title).toBe('Чернила')
    expect(ink.modes.map(m => `${m.name}:${m.value}:${m.colorScheme}`)).toEqual(['light:ink-light:light', 'dark:ink-dark:dark', 'dim:ink-dim:dark', 'sepia:ink-sepia:light'])
    expect(ink.modes[3]!.title).toBe('Сепия')
    expect(ink.defaultMode).toBe('light')
    expect(ink.href).toBeUndefined()
    expect(ink.extensions).toEqual({ granularity: { componentDefaults: { Button: { size: 'm' } } } })
    expect(manifest.activation).toEqual({ attribute: 'data-theme', value: '{theme}-{mode}' })
  })

  it('дополнительная тема — пары по шаблону сборки, адрес листа — от того, кто его выпустил', () => {
    const manifest = getThemeManifest(resolve({
      themes: [{ theme: 'ink', default: true, modes: ['light', 'dim'] }, { theme: 'paper', modes: ['light', 'dark'] }],
      activation: { attribute: 'data-look', value: '{mode}@{theme}' },
    }), { href: theme => `/assets/${theme}.css` })
    expect(manifest.activation).toEqual({ attribute: 'data-look', value: '{mode}@{theme}' })
    expect(manifest.themes[1]).toEqual({
      id: 'paper',
      title: 'Бумага',
      modes: [{ name: 'light', colorScheme: 'light', value: 'light@paper' }, { name: 'dark', colorScheme: 'dark', value: 'dark@paper' }],
      defaultMode: 'light',
      href: '/assets/paper.css',
      extensions: { granularity: { componentDefaults: { Button: { size: 's' } } } },
    })
    // У основной темы адреса нет никогда: её блоки в общем листе.
    expect(manifest.themes[0]!.href).toBeUndefined()
    expect(themeModeValue(manifest, 'dark', 'paper')).toBe('dark@paper')
    expect(themeModeValue(manifest, 'dim')).toBe('dim@ink')
  })

  it('createThemeManifest по описанию тем совпадает с манифестом сборки', () => {
    const built = getThemeManifest(resolve({ themes: [{ theme: 'ink', modes: ['dim', 'light', 'dark'] }] }))
    const made = createThemeManifest({
      themes: [{
        id: 'ink',
        title: 'Чернила',
        modes: [{ name: 'dim', colorScheme: 'dark' }, { name: 'light', colorScheme: 'light' }, { name: 'dark', title: 'Тёмный', colorScheme: 'dark' }],
        defaultMode: 'light',
      }],
    })
    expect(made.defaultTheme).toBe('ink')
    expect(made.themes[0]!.modes.map(m => m.name)).toEqual(['light', 'dim', 'dark'])
    expect(made.themes[0]!.modes.map(m => m.value)).toEqual(built.themes[0]!.modes.map(m => m.value))
    expect(made.activation).toEqual(built.activation)
    expect(createThemeManifest({ themes: made.themes, activation: { value: '{mode}@{theme}' } }).themes[0]!.modes[0]!.value).toBe('light@ink')
    expect(() => createThemeManifest({ themes: [{ ...made.themes[0]!, defaultMode: 'sepia' }] })).toThrow(/default mode 'sepia'/)
    expect(() => createThemeManifest({ themes: made.themes, defaultTheme: 'paper' })).toThrow(/default theme 'paper'/)
    expect(() => createThemeManifest({ themes: [made.themes[0]!, made.themes[0]!] })).toThrow(/listed twice/)
  })

  it('от селекции компонентов не зависит', () => {
    expect(getThemeManifest(resolve({ components: [] }))).toEqual(getThemeManifest(resolve()))
  })

  it('без тем — тем нет', () => {
    const manifest = getThemeManifest(resolveGranum({ providers: [makeManifest('@p/plain', { X: {} })] }))
    expect(manifest.themes).toEqual([])
  })
})

describe('пара, ключ выбора и тема', () => {
  it('resolveThemeActivation: пара любой темы сборки — тема и режим, чужая или пустая — undefined', () => {
    expect(resolveThemeActivation(TWO, 'ink-dim')?.mode.name).toBe('dim')
    const paper = resolveThemeActivation(TWO, 'paper-dark')
    expect(`${paper?.theme.id}/${paper?.mode.name}`).toBe('paper/dark')
    expect(resolveThemeActivation(MANIFEST, 'paper-dark')).toBeUndefined()
    expect(resolveThemeActivation(MANIFEST, null)).toBeUndefined()
  })

  it('themeModeValue: режим основной или названной темы; вне сборки — undefined', () => {
    expect(themeModeValue(MANIFEST, 'dim')).toBe('ink-dim')
    expect(themeModeValue(MANIFEST, 'sepia')).toBeUndefined()
    expect(themeModeValue(MANIFEST, 'dark', 'paper')).toBeUndefined()
    expect(themeModeValue(TWO, 'dark', 'paper')).toBe('paper-dark')
  })

  it('ключ выбора: у основной темы — режим, у дополнительной — тема и режим; чтение назад', () => {
    expect(themeSelectionKey(TWO, 'ink', 'dim')).toBe('dim')
    expect(themeSelectionKey(TWO, 'paper', 'dark')).toBe('paper-dark')
    const read = (stored: string | null): string | undefined => {
      const found = readThemeSelection(TWO, stored)
      return found && `${found.theme.id}/${found.mode.name}`
    }
    expect(read('dim')).toBe('ink/dim')
    expect(read('paper-dark')).toBe('paper/dark')
    // Ключ основной темы — без её имени: так выбор переживает смену основной темы.
    expect(read('ink-dim')).toBeUndefined()
    expect(read('clay-dark')).toBeUndefined()
    expect(read('paper-dim')).toBeUndefined()
    expect(read(null)).toBeUndefined()
    // Тему, которую нельзя выбрать (нет листа), не выбирает и чтение.
    expect(readThemeSelection(TWO, 'paper-dark', theme => theme.id !== 'paper')).toBeUndefined()
  })
})

describe('правила выбора — общие для контроллера, скрипта и потребителей', () => {
  it('carryThemeMode: заданный, одноимённый, той же схемы, по умолчанию; чужой заданный — ошибка', () => {
    const paper = TWO.themes[1]!
    const [light, dark, dim] = INK_THEME.modes
    expect(carryThemeMode(paper, dark).name).toBe('dark')
    expect(carryThemeMode(paper, dim).name).toBe('dark')
    expect(carryThemeMode(paper, undefined).name).toBe('light')
    expect(carryThemeMode(paper, light, 'dark').name).toBe('dark')
    expect(() => carryThemeMode(paper, light, 'dim')).toThrow(/mode 'dim' is not in the build of theme 'paper'/)
  })

  it('isSelectableTheme: основная — всегда, дополнительная — только с адресом листа', () => {
    expect(isSelectableTheme(TWO, TWO.themes[0]!)).toBe(true)
    expect(isSelectableTheme(TWO, TWO.themes[1]!)).toBe(true)
    expect(isSelectableTheme(TWO, withoutHref(TWO.themes[1]!))).toBe(false)
    // Тема без режимов в сборке: пары нет, ставить нечего — даже с листом.
    expect(isSelectableTheme(TWO, { ...TWO.themes[1]!, modes: [] })).toBe(false)
  })

  it('тема без режимов: setTheme — понятная ошибка до загрузки листа, а не TypeError', async () => {
    const bare: GranumThemeManifest = { ...TWO, themes: [TWO.themes[0]!, { ...TWO.themes[1]!, modes: [] }] }
    const document = fakeDocument('manual')
    const themes = createThemeController(bare, { target: createTarget(), storage: null, document })
    await expect(themes.setTheme('paper')).rejects.toThrow(/theme 'paper' has no modes in the build/)
    expect(document.links).toHaveLength(0)
  })
})

describe('loadThemeSheet', () => {
  it('ссылка вставляется один раз и ждёт загрузки; основная тема и среда без DOM — сразу', async () => {
    const document = fakeDocument()
    await Promise.all([loadThemeSheet(TWO, 'paper', { document }), loadThemeSheet(TWO, 'paper', { document })])
    expect(document.links).toHaveLength(1)
    expect(document.links[0]!.rel).toBe('stylesheet')
    expect(document.links[0]!.href).toBe('/assets/granum-theme-paper-x1.css')
    expect(document.links[0]!.attributes.get('data-granum-theme')).toBe('paper')
    await loadThemeSheet(TWO, 'paper', { document })
    expect(document.links).toHaveLength(1)
    await expect(loadThemeSheet(TWO, 'ink', { document })).resolves.toBeUndefined()
    expect(document.links).toHaveLength(1)
    vi.stubGlobal('document', undefined)
    try {
      await expect(loadThemeSheet(TWO, 'paper')).resolves.toBeUndefined()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  /** Ссылка, вставленная до загрузчика: скриптом (с отметкой состояния) или сервером (без неё). */
  function present(document: ReturnType<typeof fakeDocument>, state?: string): FakeLink {
    const link = new FakeLink()
    link.setAttribute('data-granum-theme', 'paper')
    if (state !== undefined)
      link.setAttribute('data-granum-state', state)
    link.owner = document.links
    document.links.push(link)
    return link
  }

  it('ссылку скрипта, которая ещё грузится, находит и ждёт — второй не ставит', async () => {
    const document = fakeDocument('manual')
    const script = present(document, 'loading')
    const loading = loadThemeSheet(TWO, 'paper', { document })
    script.finish('load')
    await loading
    expect(document.links).toEqual([script])
  })

  it('ссылка скрипта, которая уже упала, — отказ сразу, а не вечное ожидание; мёртвая ссылка убрана', async () => {
    const document = fakeDocument('manual')
    present(document, 'error')
    await expect(loadThemeSheet(TWO, 'paper', { document })).rejects.toThrow(/failed to load/)
    expect(document.links).toEqual([])
  })

  it('ссылку сервера без листа заменяет своей — грузится она или упала, по DOM не различить; двух ссылок нет', async () => {
    const document = fakeDocument('manual')
    const server = present(document)
    const loading = loadThemeSheet(TWO, 'paper', { document })
    expect(document.links).toHaveLength(1)
    expect(document.links[0]).not.toBe(server)
    document.links[0]!.finish('load')
    await loading
    // Ссылка сервера с листом — уже загружена: ждать нечего, менять незачем.
    const loaded = fakeDocument('manual')
    const ready = present(loaded)
    ready.sheet = {}
    await loadThemeSheet(TWO, 'paper', { document: loaded })
    expect(loaded.links).toEqual([ready])
  })

  it('после ошибки лист грузится заново: отказ не кэшируется, мёртвая ссылка не остаётся', async () => {
    const document = fakeDocument('manual')
    const first = loadThemeSheet(TWO, 'paper', { document })
    document.links[0]!.finish('error')
    await expect(first).rejects.toThrow(/failed to load/)
    expect(document.links).toEqual([])
    const second = loadThemeSheet(TWO, 'paper', { document })
    expect(document.links).toHaveLength(1)
    document.links[0]!.finish('load')
    await expect(second).resolves.toBeUndefined()
  })

  it('лист, подключённый статически, узнаёт по метке и второй ссылки не ставит', async () => {
    const marked = (value: string | Error) => ({
      ...fakeDocument('manual'),
      documentElement: {},
      defaultView: {
        getComputedStyle: () => ({
          getPropertyValue: (name: string) => {
            if (value instanceof Error)
              throw value
            return name === '--granum-sheet-paper' ? value : ''
          },
        }),
      },
    })
    const present = marked(' 1')
    await expect(loadThemeSheet(TWO, 'paper', { document: present })).resolves.toBeUndefined()
    expect(present.links).toHaveLength(0)
    // Метки нет или читать её нечем — ссылка, как раньше.
    const absent = marked('')
    void loadThemeSheet(TWO, 'paper', { document: absent })
    expect(absent.links).toHaveLength(1)
    const broken = marked(new Error('no CSSOM'))
    void loadThemeSheet(TWO, 'paper', { document: broken })
    expect(broken.links).toHaveLength(1)
  })

  it('тема не из сборки, тема без адреса и ошибка загрузки — отказ', async () => {
    await expect(loadThemeSheet(TWO, 'clay', { document: fakeDocument() })).rejects.toThrow(/'clay' is not in the build/)
    const noHref: GranumThemeManifest = { ...TWO, themes: [TWO.themes[0]!, withoutHref(TWO.themes[1]!)] }
    await expect(loadThemeSheet(noHref, 'paper', { document: fakeDocument() })).rejects.toThrow(/no sheet address/)
    await expect(loadThemeSheet(TWO, 'paper', { document: fakeDocument('fail') })).rejects.toThrow(/failed to load/)
  })

  it('themeSheetLink: атрибуты ссылки для серверного <head>; у основной — нет', () => {
    expect(themeSheetLink(TWO, 'paper')).toEqual({ 'rel': 'stylesheet', 'href': '/assets/granum-theme-paper-x1.css', 'data-granum-theme': 'paper' })
    expect(themeSheetLink(TWO, 'ink')).toBeUndefined()
    expect(() => themeSheetLink(TWO, 'clay')).toThrow(/'clay' is not in the build/)
  })
})

describe('createThemeController', () => {
  it('режим по умолчанию, переключение, хранение ключа, cycle и подписки', () => {
    const target = createTarget()
    const storage = memoryStorage()
    const themes = createThemeController(MANIFEST, { target, storage, prefersDark: () => false })
    expect(themes.mode).toBe('light')
    expect(themes.theme.id).toBe('ink')
    expect(target.attributes.get('data-theme')).toBe('ink-light')
    const seen: string[] = []
    const stop = themes.subscribe(state => seen.push(`${state.theme}/${state.mode}`))
    themes.setMode('dim')
    expect(target.attributes.get('data-theme')).toBe('ink-dim')
    expect(storage.data.get('granum-theme')).toBe('dim')
    expect(themes.cycle()).toBe('light')
    stop()
    themes.setMode('dark')
    expect(seen).toEqual(['ink/dim', 'ink/light'])
    expect(themes.modes().map(m => m.name)).toEqual(['light', 'dark', 'dim'])
    expect(themes.themes().map(t => t.id)).toEqual(['ink'])
  })

  it('auto: сохранённый выбор → системная схема → режим по умолчанию', () => {
    expect(createThemeController(MANIFEST, { target: createTarget(), storage: memoryStorage({ 'granum-theme': 'dim' }) }).mode).toBe('dim')
    expect(createThemeController(MANIFEST, { target: createTarget(), storage: memoryStorage({ 'granum-theme': 'gone' }), prefersDark: () => true }).mode).toBe('dark')
    expect(createThemeController(MANIFEST, { target: createTarget(), storage: null, prefersDark: () => false }).mode).toBe('light')
    expect(createThemeController(MANIFEST, { target: createTarget(), storage: null, initial: 'dim' }).mode).toBe('dim')
  })

  it('поверх уже выставленной пары: тема и режим узнаны, корень не тронут', async () => {
    const target = createTarget({ 'data-theme': 'ink-dark' })
    const themes = createThemeController(MANIFEST, { target, storage: memoryStorage({ 'granum-theme': 'dim' }) })
    expect(themes.mode).toBe('dark')
    expect(target.writes).toBe(0)
    // Пара дополнительной темы от сервера: лист ищется, корень не трогается.
    const document = fakeDocument()
    const paperTarget = createTarget({ 'data-theme': 'paper-dark' })
    const paper = createThemeController(TWO, { target: paperTarget, storage: null, document })
    await paper.ready
    expect(`${paper.theme.id}/${paper.mode}`).toBe('paper/dark')
    expect(paperTarget.writes).toBe(0)
    expect(document.links).toHaveLength(1)
  })

  it('initial — выбор явно: режим основной темы или { theme?, mode? }; без записи в хранилище', async () => {
    const document = fakeDocument()
    const target = createTarget()
    const storage = memoryStorage({ 'granum-theme': 'dim' })
    const paper = createThemeController(TWO, { target, storage, document, initial: { theme: 'paper', mode: 'dark' } })
    // Дополнительная тема — как сохранённая: пара после листа.
    expect(target.writes).toBe(0)
    await paper.ready
    expect(target.attributes.get('data-theme')).toBe('paper-dark')
    expect(storage.data.get('granum-theme')).toBe('dim')

    expect(createThemeController(TWO, { target: createTarget(), storage: null, document, initial: { theme: 'paper' } }).mode).toBe('light')
    expect(createThemeController(TWO, { target: createTarget(), storage: null, initial: { mode: 'dim' } }).theme.id).toBe('ink')
    expect(() => createThemeController(TWO, { target: createTarget(), storage: null, initial: { theme: 'clay' } })).toThrow(/theme 'clay' is not in the build/)
    expect(() => createThemeController(TWO, { target: createTarget(), storage: null, initial: { theme: 'paper', mode: 'dim' } })).toThrow(/mode 'dim'/)
  })

  it('setTheme: сначала лист, потом пара; режим — одноимённый, иначе той же схемы, иначе по умолчанию', async () => {
    const document = fakeDocument('manual')
    const target = createTarget()
    const storage = memoryStorage()
    const themes = createThemeController(TWO, { target, storage, document, initial: 'dark' })
    const switching = themes.setTheme('paper')
    // Пока лист не загружен, пара старая: значения темы без листа — чужие.
    expect(target.attributes.get('data-theme')).toBe('ink-dark')
    document.links[0]!.finish('load')
    await switching
    expect(target.attributes.get('data-theme')).toBe('paper-dark')
    expect(storage.data.get('granum-theme')).toBe('paper-dark')
    expect(themes.modes().map(m => m.name)).toEqual(['light', 'dark'])

    themes.setMode('light')
    await themes.setTheme('ink')
    expect(target.attributes.get('data-theme')).toBe('ink-light')
    expect(storage.data.get('granum-theme')).toBe('light')

    themes.setMode('dim')
    await themes.setTheme('paper')
    // `dim` у бумаги нет — первый режим той же схемы.
    expect(target.attributes.get('data-theme')).toBe('paper-dark')
    await themes.setTheme('ink', { mode: 'light' })
    expect(target.attributes.get('data-theme')).toBe('ink-light')
    await expect(themes.setTheme('ink', { mode: 'sepia' })).rejects.toThrow(/mode 'sepia'/)
    await expect(themes.setTheme('clay')).rejects.toThrow(/theme 'clay' is not in the build/)
  })

  it('выбор, сделанный, пока грузился лист, не перебивается устаревшим', async () => {
    const document = fakeDocument('manual')
    const target = createTarget()
    const themes = createThemeController(TWO, { target, storage: null, document })
    const switching = themes.setTheme('paper')
    themes.setMode('dim')
    document.links[0]!.finish('load')
    await switching
    expect(target.attributes.get('data-theme')).toBe('ink-dim')
    expect(themes.theme.id).toBe('ink')
  })

  it('сохранённая дополнительная тема — после загрузки листа; ошибка листа — основная тема', async () => {
    const document = fakeDocument()
    const target = createTarget()
    const themes = createThemeController(TWO, { target, storage: memoryStorage({ 'granum-theme': 'paper-dark' }), document })
    expect(target.attributes.get('data-theme')).toBeUndefined()
    await themes.ready
    expect(target.attributes.get('data-theme')).toBe('paper-dark')

    const broken = createTarget()
    const fallback = createThemeController(TWO, { target: broken, storage: memoryStorage({ 'granum-theme': 'paper-dark' }), document: fakeDocument('fail') })
    await expect(fallback.ready).rejects.toThrow(/failed to load/)
    expect(broken.attributes.get('data-theme')).toBe('ink-dark')
    expect(fallback.theme.id).toBe('ink')
  })

  it('пока грузится лист сохранённой темы, setMode пары не ставит; после загрузки — пара последнего режима', async () => {
    const document = fakeDocument('manual')
    const target = createTarget()
    const storage = memoryStorage({ 'granum-theme': 'paper-light' })
    const themes = createThemeController(TWO, { target, storage, document })
    themes.setMode('dark')
    expect(themes.mode).toBe('dark')
    expect(target.attributes.get('data-theme')).toBeUndefined()
    document.links[0]!.finish('load')
    await themes.ready
    expect(target.attributes.get('data-theme')).toBe('paper-dark')
    expect(storage.data.get('granum-theme')).toBe('paper-dark')
  })

  it('лист сохранённой темы упал после setMode — основная тема с тем же режимом', async () => {
    const document = fakeDocument('manual')
    const target = createTarget()
    const themes = createThemeController(TWO, { target, storage: memoryStorage({ 'granum-theme': 'paper-light' }), document })
    themes.cycle()
    document.links[0]!.finish('error')
    await expect(themes.ready).rejects.toThrow(/failed to load/)
    expect(themes.theme.id).toBe('ink')
    expect(target.attributes.get('data-theme')).toBe('ink-dark')
  })

  it('неверный setMode, пока грузится лист, первую загрузку не отменяет', async () => {
    const document = fakeDocument('manual')
    const target = createTarget()
    const themes = createThemeController(TWO, { target, storage: memoryStorage({ 'granum-theme': 'paper-dark' }), document })
    expect(() => themes.setMode('sepia')).toThrow(/mode 'sepia'/)
    document.links[0]!.finish('load')
    await themes.ready
    expect(target.attributes.get('data-theme')).toBe('paper-dark')
  })

  it('пара скрипта, чей лист уже упал, — основная тема, а не вечное ожидание', async () => {
    const document = fakeDocument('manual')
    const failed = new FakeLink()
    failed.setAttribute('data-granum-theme', 'paper')
    failed.setAttribute('data-granum-state', 'error')
    failed.owner = document.links
    document.links.push(failed)
    const target = createTarget()
    target.setAttribute('data-theme', 'paper-dark')
    const themes = createThemeController(TWO, { target, storage: null, document })
    await expect(themes.ready).rejects.toThrow(/failed to load/)
    expect(themes.theme.id).toBe('ink')
    expect(target.attributes.get('data-theme')).toBe('ink-dark')
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

  it('ошибки: неизвестный режим, манифест без режимов', () => {
    const themes = createThemeController(MANIFEST, { target: createTarget(), storage: null })
    expect(() => themes.setMode('sepia')).toThrow(/mode 'sepia' is not in the build of theme 'ink'/)
    expect(() => createThemeController({ ...MANIFEST, themes: [{ ...INK_THEME, modes: [] }] })).toThrow(/no modes/)
    expect(() => createThemeController({ ...MANIFEST, themes: [] })).toThrow(/default theme/)
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
  interface ScriptEnv { attribute?: string | undefined, stored?: string | null, cookie?: string, dark?: boolean, noMatchMedia?: boolean, storageThrows?: boolean, serverLink?: string }

  function runCode(code: string, env: ScriptEnv = {}): { attribute: string | undefined, links: FakeLink[], listeners: Map<string, () => void> } {
    const attributes = new Map<string, string>(env.attribute ? [['data-theme', env.attribute]] : [])
    const listeners = new Map<string, () => void>()
    const matchMedia = env.noMatchMedia ? undefined : () => ({ matches: env.dark === true })
    const sheets = fakeDocument('manual')
    if (env.serverLink) {
      const link = new FakeLink()
      link.setAttribute('data-granum-theme', env.serverLink)
      sheets.links.push(link)
    }
    runInNewContext(code, {
      document: {
        documentElement: { getAttribute: (n: string) => attributes.get(n) ?? null, setAttribute: (n: string, v: string) => void attributes.set(n, v) },
        cookie: env.cookie ?? '',
        addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
        head: sheets.head,
        createElement: sheets.createElement,
        querySelector: sheets.querySelector,
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
    return { attribute: attributes.get('data-theme'), links: sheets.links, listeners }
  }

  function runScript(html: string, env: ScriptEnv = {}): string | undefined {
    return runCode(/<script[^>]*>([\s\S]*)<\/script>/.exec(html)![1]!, env).attribute
  }

  /** Что выберет контроллер с `initial: 'auto'` на тех же входах — после загрузки листа. */
  async function controllerPair(manifest: GranumThemeManifest, env: ScriptEnv): Promise<string | undefined> {
    const target = createTarget(env.attribute ? { 'data-theme': env.attribute } : {})
    const themes = createThemeController(manifest, { target, storage: memoryStorage(env.stored ? { 'granum-theme': env.stored } : {}), prefersDark: () => env.dark === true, document: fakeDocument() })
    await themes.ready
    return target.attributes.get('data-theme')
  }

  it('выбирает ту же пару, что контроллер, во всех сочетаниях входов', async () => {
    const darkDefault: GranumThemeManifest = { ...MANIFEST, themes: [{ ...INK_THEME, modes: [INK_THEME.modes[2]!, INK_THEME.modes[0]!], defaultMode: 'dim' }] }
    const single: GranumThemeManifest = { ...MANIFEST, themes: [{ ...INK_THEME, modes: [INK_THEME.modes[1]!], defaultMode: 'dark' }] }
    for (const manifest of [MANIFEST, darkDefault, single, TWO]) {
      const code = createThemeScriptCode({ manifest })
      for (const attribute of [undefined, 'ink-dim', 'ink-light', 'paper-dark']) {
        for (const stored of [null, 'light', 'dark', 'dim', 'paper-dark', 'paper-dim', 'clay-dark', 'nope', '', 'constructor', 'toString']) {
          for (const dark of [true, false]) {
            const env = { attribute, stored, dark }
            expect(runCode(code, env).attribute, `${manifest.themes.map(t => t.id).join('+')} ${JSON.stringify(env)}`).toBe(await controllerPair(manifest, env))
          }
        }
      }
    }
  })

  it('дополнительная тема: <link> листа с blocking="render" — до пары; ссылку сервера не дублирует', () => {
    const code = createThemeScriptCode({ manifest: TWO })
    const run = runCode(code, { stored: 'paper-dark' })
    expect(run.attribute).toBe('paper-dark')
    expect(run.links).toHaveLength(1)
    expect(run.links[0]!.rel).toBe('stylesheet')
    expect(run.links[0]!.href).toBe('/assets/granum-theme-paper-x1.css')
    expect(run.links[0]!.attributes.get('blocking')).toBe('render')
    expect(run.links[0]!.attributes.get('data-granum-theme')).toBe('paper')
    expect(runCode(code, { stored: 'paper-dark', serverLink: 'paper' }).links).toHaveLength(1)
    // Основная тема листа не просит.
    expect(runCode(code, { stored: 'dim' }).links).toHaveLength(0)
  })

  it('ссылку скрипт отмечает состоянием: загрузчик, пришедший позже, узнаёт и загрузку, и ошибку', async () => {
    const code = createThemeScriptCode({ manifest: TWO })
    for (const type of ['load', 'error'] as const) {
      const link = runCode(code, { stored: 'paper-dark' }).links[0]! as FakeLink & { onload: (event: { type: string }) => void, onerror: (event: { type: string }) => void }
      expect(link.attributes.get('data-granum-state')).toBe('loading')
      // Событие случилось до загрузчика: подписаться на него он уже не успеет.
      link[type === 'load' ? 'onload' : 'onerror']({ type })
      expect(link.attributes.get('data-granum-state')).toBe(type)
      const document = { head: { appendChild: () => {} }, createElement: () => new FakeLink(), querySelector: () => link }
      const loading = loadThemeSheet(TWO, 'paper', { document })
      if (type === 'load')
        await expect(loading).resolves.toBeUndefined()
      else
        await expect(loading).rejects.toThrow(/failed to load/)
    }
  })

  it('тема без адреса листа в выбор не попадает: вместо неё — основная', () => {
    const early: GranumThemeManifest = { ...TWO, themes: [TWO.themes[0]!, withoutHref(TWO.themes[1]!)] }
    const code = createThemeScriptCode({ manifest: early })
    expect(code).not.toContain('paper')
    const run = runCode(code, { stored: 'paper-dark', dark: true })
    expect(run.attribute).toBe('ink-dark')
    expect(run.links).toHaveLength(0)
  })

  it('пара от сервера не трогается; cookie раньше localStorage', () => {
    expect(runScript(createThemeScript({ manifest: MANIFEST }), { attribute: 'ink-dim', stored: 'light' })).toBe('ink-dim')
    const withCookie = createThemeScript({ manifest: MANIFEST, cookie: 'gr.mode' })
    expect(runScript(withCookie, { cookie: 'a=1; gr.mode=dark', stored: 'light' })).toBe('ink-dark')
    expect(runScript(withCookie, { cookie: 'grXmode=dark', stored: 'dim' })).toBe('ink-dim')
    expect(runScript(withCookie, { cookie: 'gr.mode=nope', stored: 'dim' })).toBe('ink-dim')
    expect(runScript(createThemeScript({ manifest: TWO, cookie: 'gr.mode' }), { cookie: 'gr.mode=paper-light', stored: 'dim' })).toBe('paper-light')
    // Без `cookie` чужая cookie с именем ключа выбор не перебивает.
    expect(runScript(createThemeScript({ manifest: MANIFEST }), { cookie: 'granum-theme=dark', stored: 'light' })).toBe('ink-light')
  })

  it('ничего не бросает наружу: без DOM, без matchMedia, с бросающим хранилищем', () => {
    const code = createThemeScriptCode({ manifest: TWO, cookie: 'mode', reapplyOn: ['astro:after-swap'] })
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

  it('код собран под манифест: без cookie, листов и с одной схемой лишних веток нет', () => {
    const code = createThemeScriptCode({ manifest: MANIFEST })
    expect(code).not.toContain('cookie')
    expect(code).not.toContain('addEventListener')
    expect(code).not.toContain('createElement')
    expect(code).toContain('m={light:"ink-light",dark:"ink-dark",dim:"ink-dim"}')
    expect(createThemeScriptCode({ manifest: { ...MANIFEST, themes: [{ ...INK_THEME, modes: [INK_THEME.modes[0]!] }] } })).not.toContain('matchMedia')
  })

  it('укладывается в 512 Б на одной теме из двух режимов — даже с cookie и повтором по событию', () => {
    const slate: GranumThemeManifest = {
      themes: [{ id: 'slate', title: 'Slate', modes: [{ name: 'light', colorScheme: 'light', value: 'slate-light' }, { name: 'dark', colorScheme: 'dark', value: 'slate-dark' }], defaultMode: 'light' }],
      defaultTheme: 'slate',
      activation: { attribute: 'data-theme' },
    }
    const code = createThemeScriptCode({ manifest: slate, storageKey: 'gr-theme', cookie: 'gr-theme', reapplyOn: ['astro:after-swap'] })
    expect(new TextEncoder().encode(code).length).toBeLessThanOrEqual(512)
  })

  it('nonce в теге; закрывающий тег в данных не ломает скрипт; плохое имя cookie и пустой манифест — ошибка', () => {
    const script = createThemeScript({ manifest: { ...MANIFEST, themes: [{ ...INK_THEME, modes: [{ ...INK_THEME.modes[0]!, value: '</script>' }] }] }, nonce: 'abc"' })
    expect(script.startsWith('<script nonce="abc&quot;">')).toBe(true)
    expect(script.match(/<\/script>/g)).toHaveLength(1)
    expect(() => createThemeScript({ manifest: MANIFEST, cookie: 'a;b' })).toThrow(/cookie token/)
    expect(() => createThemeScript({ manifest: MANIFEST, cookie: '</script>' })).toThrow(/cookie token/)
    expect(() => createThemeScript({ manifest: { ...MANIFEST, themes: [{ ...INK_THEME, modes: [] }] } })).toThrow(/no modes/)
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

  it('хранилище пишет и читает выбор; сервер находит в заголовке тему и режим', () => {
    const doc = { cookie: '' }
    const storage = createCookieStorage({ name: 'mode', document: doc })
    storage.setItem('ignored', 'paper-dark')
    expect(doc.cookie).toMatch(/^mode=paper-dark; Max-Age=\d+; Path=\/; SameSite=lax$/)
    expect(createCookieStorage({ name: 'mode', document: { cookie: 'x=1; mode=dark' } }).getItem('mode')).toBe('dark')
    expect(themeFromCookie(MANIFEST, 'x=1; granum-theme=dim')?.mode.value).toBe('ink-dim')
    expect(themeFromCookie(TWO, 'granum-theme=paper-dark')?.mode.value).toBe('paper-dark')
    expect(themeFromCookie(MANIFEST, 'granum-theme=sepia')).toBeUndefined()
    expect(themeRootAttributes(MANIFEST, { mode: 'dark' })).toEqual({ 'data-theme': 'ink-dark' })
    expect(themeRootAttributes(MANIFEST)).toEqual({ 'data-theme': 'ink-light' })
    expect(themeRootAttributes(TWO, { theme: 'paper', mode: 'dark' })).toEqual({ 'data-theme': 'paper-dark' })
    expect(themeRootAttributes(TWO, { theme: 'paper' })).toEqual({ 'data-theme': 'paper-light' })
    expect(() => themeRootAttributes(TWO, { theme: 'clay' })).toThrow(/'clay' is not in the build/)
  })
})
