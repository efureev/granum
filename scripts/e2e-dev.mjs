#!/usr/bin/env node
/**
 * e2e на dev-сервере: два утверждения, которые
 * нельзя проверить ни снапшотом CSS, ни отчётом сборки.
 *
 *   Утилита приложения перебивает базовый стиль компонента.
 *     Проверяется вычисленным стилем в браузере: порядок слоёв каскада
 *     подтверждает только сам каскад, а не текст файла.
 *   Правка исходника приложения обновляет слой `utilities` по HMR,
 *     без перезагрузки страницы. Отсутствие перезагрузки — тоже наблюдаемый
 *     факт: маркер, положенный в `window`, обязан пережить обновление.
 *
 * Стенд — `apps/app-1`: один компонент с собственным `gap` из слоя
 * `components` и утилита `gap-0` из слоя `utilities`, дописываемая в разметку
 * на ходу.
 *
 * Второй стенд — `apps/app-5`: он импортирует `virtual:granum/themes`,
 * JS-модуль без границы HMR. Правка разметки его код не меняет и не обязана
 * его перезагружать — иначе обновление поднимается до входа приложения, и Vite
 * перезагружает страницу.
 *
 * Третий сценарий — тема и её режимы (`@granum-fixtures/themed-ds` поверх
 * владельца тем, которого приложение не перечисляет): собранный
 * `createThemeController` переключает пары, остров режима и вложенный остров
 * пересчитывают значения и формулы на своём элементе, дополнительная тема не
 * задевает корень, а значение в браузере совпадает с `granum tokens`.
 *
 * Четвёртый — ветка фолбэков `@supports`, которую браузер разработчика не
 * видит никогда: условие фолбэков здесь истинное в Chromium, и страница видит
 * каскад браузера без фичи. Рядом — формулы дополнительной темы: префикс значения пары не
 * должен доставать корень активной темы.
 *
 * Пятый — собранный лист настоящих стендов (`app-theme-ink`, `app-5`):
 * минификатор Vite сливает соседние правила фолбэков и режимов и переписывает
 * значения, а каскад обязан остаться тем же, что у вывода `emitCss`.
 *
 * Правка исходника откатывается в `finally` при любом исходе: файл рабочего
 * дерева, и оставить его изменённым нельзя.
 *
 * Запуск: `yarn e2e` (в CI — своя джоба; в `test:all` не входит, чтобы
 * локальный прогон не тянул браузер).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { resolveTokenValue } from '@feugene/granum'
import { emitCss, getThemeManifest, loadGranumConfigFile, prepareApp } from '@feugene/granum/node'
import { windEngine } from '@feugene/granum-engine-wind'
import { chromium } from 'playwright'
import { build, createServer } from 'vite'

const root = fileURLToPath(new URL('../apps/app-1/', import.meta.url))
const appSource = join(root, 'src/App.vue')
const original = readFileSync(appSource, 'utf8')

/**
 * Пауза после обновления. Перезагрузка, если она будет, приходит следом за
 * HMR-обновлениями: проверка сразу после них её не застала бы и осталась бы
 * зелёной на дефекте.
 */
const SETTLE_MS = 1500

/** Утилита, которой в разметке ещё нет: её правило обязано приехать по HMR. */
const HMR_CLASS = 'gap-0'
const failures = []
const steps = []

function check(ok, message) {
  steps.push(`${ok ? '✓' : '✗'} ${message}`)
  if (!ok)
    failures.push(message)
}

let server
let browser

try {
  server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'warn',
    server: { port: 5199, strictPort: true },
  })
  await server.listen()
  const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5199/app-1/'

  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  // Слушатель ставится ПОСЛЕ первой навигации: её событие `load` законно, и
  // считать нужно только те, что случились из-за обновления.
  const reloads = []
  page.on('load', () => reloads.push(Date.now()))

  // Маркер живёт в `window`: перезагрузка страницы его потеряет, HMR — нет.
  await page.evaluate(() => {
    window.__granumE2E = 'before-hmr'
  })

  const before = await page.evaluate(() => {
    const element = document.querySelector('.x-sp-test')
    if (!element)
      return null
    const style = getComputedStyle(element)
    const styles = [...document.querySelectorAll('style')].map(node => node.textContent).join('\n')
    return {
      gap: style.rowGap,
      padding: style.padding,
      fontWeight: style.fontWeight,
      layers: styles.match(/@layer [^{;]+;/)?.[0] ?? '',
      hasHmrRule: styles.includes(`.${CSS.escape('gap-0')}`),
    }
  })

  check(before !== null, 'компонент селекции отрендерился (`.x-sp-test` в DOM)')
  check(before?.layers === '@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;',
    `порядок слоёв объявлен первой строкой: ${before?.layers || '—'}`)
  check(before?.gap === '12px', `базовый \`gap\` компонента из слоя components: ${before?.gap}`)
  check(before?.padding === '16px', `утилита \`p-4\` из манифеста применилась: ${before?.padding}`)
  check(before?.fontWeight === '700', `\`@apply\`, раскрытый на сборке провайдера, доехал: font-weight ${before?.fontWeight}`)
  check(before?.hasHmrRule === false, `правила \`.${HMR_CLASS}\` в CSS пока нет — иначе проверка HMR ничего не значит`)

  // Правка разметки: класс появляется впервые, значит слой `utilities` обязан
  // перегенерироваться и приехать по HMR.
  writeFileSync(appSource, original.replace('<XTest1>', `<XTest1 class="${HMR_CLASS}">`), 'utf8')

  /*
   * Ждём ДВА факта, а не один: правило в CSS и класс на элементе.
   *
   * Обновлений здесь два и они независимы: слой `utilities` перегенерировался
   * (это CSS) и Vue перерисовал компонент с новым атрибутом `class` (это DOM).
   * Дождавшись только правила, можно прочитать вычисленный стиль элемента, на
   * котором класса ещё нет, — так проверка и краснела в CI, оставаясь зелёной
   * локально из-за разницы в скорости.
   */
  await page.waitForFunction(
    () => {
      const element = document.querySelector('.x-sp-test')
      const hasRule = [...document.querySelectorAll('style')].some(node => node.textContent?.includes('.gap-0'))
      return Boolean(element?.classList.contains('gap-0')) && hasRule
    },
    undefined,
    { timeout: 20_000 },
  )
  await page.waitForTimeout(SETTLE_MS)

  const after = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.x-sp-test'))
    return { gap: style.rowGap, marker: window.__granumE2E }
  })

  check(after.marker === 'before-hmr', 'страница не перезагружалась: маркер в `window` пережил обновление')
  check(reloads.length === 0, `полных перезагрузок после правки: ${reloads.length}`)
  check(after.gap === '0px', `утилита приложения перебила базовый \`gap\` компонента: ${after.gap}`)
}
catch (error) {
  failures.push(`прогон упал: ${error?.message ?? error}`)
}
finally {
  writeFileSync(appSource, original, 'utf8')
  await browser?.close()
  await server?.close()
}

/*
 * app-5: правка разметки приезжает по HMR и у приложения с модулем тем.
 */
const themedRoot = fileURLToPath(new URL('../apps/app-5/', import.meta.url))
const themedSource = join(themedRoot, 'src/App.vue')
const themedOriginal = readFileSync(themedSource, 'utf8')
const THEMED_CLASS = 'italic'

try {
  server = await createServer({
    root: themedRoot,
    configFile: join(themedRoot, 'vite.config.ts'),
    logLevel: 'warn',
    server: { port: 5198, strictPort: true },
  })
  await server.listen()
  const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5198/app-5/'

  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  const reloads = []
  page.on('load', () => reloads.push(Date.now()))
  await page.evaluate(() => {
    window.__granumE2E = 'before-hmr'
  })

  const before = await page.evaluate(cls => ({
    rendered: document.querySelector('main') !== null,
    hasRule: [...document.querySelectorAll('style')].some(node => node.textContent?.includes(`.${cls}`)),
  }), THEMED_CLASS)
  check(before.rendered, 'app-5: страница отрендерилась (`main` в DOM)')
  check(before.hasRule === false, `app-5: правила \`.${THEMED_CLASS}\` в CSS пока нет`)

  writeFileSync(themedSource, themedOriginal.replace('<main class="', `<main class="${THEMED_CLASS} `), 'utf8')
  await page.waitForFunction(
    cls => Boolean(document.querySelector('main')?.classList.contains(cls))
      && [...document.querySelectorAll('style')].some(node => node.textContent?.includes(`.${cls}`)),
    THEMED_CLASS,
    { timeout: 20_000 },
  )
  await page.waitForTimeout(SETTLE_MS)
  const after = await page.evaluate(() => ({
    marker: window.__granumE2E,
    fontStyle: getComputedStyle(document.querySelector('main')).fontStyle,
  }))

  check(after.marker === 'before-hmr', 'app-5: страница не перезагружалась — модуль тем не перезагружен')
  check(reloads.length === 0, `app-5: полных перезагрузок после правки: ${reloads.length}`)
  check(after.fontStyle === 'italic', `app-5: утилита приехала по HMR: font-style ${after.fontStyle}`)
}
catch (error) {
  failures.push(`app-5: прогон упал: ${error?.message ?? error}`)
}
finally {
  writeFileSync(themedSource, themedOriginal, 'utf8')
  await browser?.close()
  await server?.close()
}

/*
 * Каскад тем и режимов: одна тема на `:root`, режимы — пары в атрибуте, остров
 * режима и дополнительной темы пересчитывают значения на своём элементе.
 * Страница — один CSS сборки, без dev-сервера: проверяется каскад, а не HMR.
 */
const OVERRIDE = '#4fd1e0'
const appsRoot = fileURLToPath(new URL('../apps/app-components/', import.meta.url))
try {
  const app = await prepareApp({
    engine: windEngine(),
    providers: ['@granum-fixtures/themed-ds'],
    themes: [
      { theme: 'ink', default: true, modes: { names: ['light', 'dark', 'dim', 'ocean'], define: { ocean: { extends: 'dark', colorScheme: 'dark', tokens: { 'th-fg': OVERRIDE } } }, tokenOverrides: { dark: { 'th-line': '#123456' } } } },
      { theme: 'paper', modes: ['light', 'dark'] },
    ],
    // Каскад проверяется на токенах тем, которых не читает ни один компонент:
    // обрезка (по умолчанию она включена) сняла бы их.
    pruneTokens: { mode: 'off' },
  }, appsRoot)
  const emitted = await emitCss(app)
  // Лист дополнительной темы — раньше общего: каскад от порядка листов не зависит.
  const css = `${Object.values(emitted.themeSheets).join('\n')}\n${emitted.css}`

  // Манифест — пары тем сборки; от селекции компонентов он не зависит.
  const pairsOf = manifest => manifest.themes.map(theme => theme.modes.map(mode => mode.value).join(',')).join(';')
  const manifest = getThemeManifest(app.resolution)
  check(pairsOf(manifest) === 'ink-light,ink-dark,ink-dim,ink-ocean;paper-light,paper-dark', `пары манифеста: ${pairsOf(manifest)}`)
  const bare = await prepareApp({ engine: windEngine(), providers: ['@granum-fixtures/themed-ds'], components: [], themes: [{ theme: 'ink', default: true, modes: { names: ['light', 'dark', 'dim', 'ocean'], define: { ocean: { extends: 'dark' } } } }, { theme: 'paper', modes: ['light', 'dark'] }] }, appsRoot)
  check(pairsOf(getThemeManifest(bare.resolution)) === pairsOf(manifest), `пары манифеста при селекции []: ${pairsOf(getThemeManifest(bare.resolution))}`)

  // Страница с CSS сборки и собранным `@feugene/granum/runtime`: файлы `dist` отдаёт route.
  const runtimeDir = fileURLToPath(new URL('../packages/granum/dist/', import.meta.url))
  const body = '<div id="island" data-theme="ink-dark"><div id="nested" data-theme="ink-dim"></div></div>'
    + '<div id="preview" data-theme="paper-dark"></div>'
  const html = `<!doctype html><html><head><style>${css}</style></head><body>${body}<script type="module">`
    + `import { createThemeController, loadThemeSheet } from '/runtime.js';`
    + `window.loadThemeSheet = loadThemeSheet;`
    + `window.themes = createThemeController(${JSON.stringify(manifest)}, { storage: null, prefersDark: () => false })</script></body></html>`
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.route('http://granum.test/**', (route) => {
    const path = new URL(route.request().url()).pathname
    return path === '/'
      ? route.fulfill({ contentType: 'text/html', body: html })
      : route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(runtimeDir, path.slice(1))) })
  })
  // Ошибка контроллера на странице — причина провала, а не таймаут ожидания.
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('http://granum.test/')
  await page.waitForFunction(() => window.themes !== undefined, undefined, { timeout: 5000 })
    .catch(() => { throw new Error(`контроллер режимов не создан: ${pageErrors.join('; ') || 'без ошибки страницы'}`) })

  const read = (selector, token) => page.evaluate(([sel, name]) => getComputedStyle(sel === 'html' ? document.documentElement : document.querySelector(sel)).getPropertyValue(name).trim(), [selector, token])
  const attribute = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))

  check(await attribute() === 'ink-light', `контроллер выставил пару режима по умолчанию: ${await attribute()}`)
  check(await read('html', '--th-bg') === '#ffffff', `ink-light: --th-bg корня: ${await read('html', '--th-bg')}`)
  await page.evaluate(() => window.themes.setMode('dim'))
  check(await attribute() === 'ink-dim', `контроллер переключил режим: ${await attribute()}`)
  check(await read('html', '--th-bg') === '#1e293b', `ink-dim: --th-bg корня: ${await read('html', '--th-bg')}`)
  check(await read('html', '--td-button-shadow') === 'none', `ink-dim: токен кнопки по цепочкам dim → dark, ink → paper: ${await read('html', '--td-button-shadow')}`)
  await page.evaluate(() => window.themes.setMode('light'))

  // Остров режима на светлой странице и вложенный остров внутри него.
  check(await read('#island', '--th-bg') === '#0f172a', `остров ink-dark: --th-bg: ${await read('#island', '--th-bg')}`)
  check(await read('#island', '--th-line') === '#123456', `остров ink-dark: override режима: ${await read('#island', '--th-line')}`)
  check(await read('#nested', '--th-bg') === '#1e293b', `вложенный остров ink-dim: --th-bg: ${await read('#nested', '--th-bg')}`)
  // Формула под общей границей пересчитана на острове по его ролям, а не унаследована от корня.
  const resolvedShade = sel => page.evaluate(s => {
    const probe = document.createElement('i')
    probe.style.color = 'var(--th-shade)'
    document.querySelector(s).append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, sel)
  check(await resolvedShade('#island') !== await resolvedShade('body'), `--th-shade острова посчитана по его ролям: ${await resolvedShade('#island')} vs ${await resolvedShade('body')}`)

  // Остров дополнительной темы: полный блок своей пары, корень не задет.
  check(await read('#preview', '--th-radius') === '6px', `остров paper-dark: свой --th-radius: ${await read('#preview', '--th-radius')}`)
  check(await read('#preview', '--th-accent') === '#60a5fa', `остров paper-dark: --th-accent: ${await read('#preview', '--th-accent')}`)
  check(await read('html', '--th-radius') === '2px', `корень остался ink: --th-radius: ${await read('html', '--th-radius')}`)

  // Лист, подключённый статически, загрузчик узнаёт по метке `@property` — второй ссылки нет.
  check(await read('html', '--granum-sheet-paper') === '1', `метка статического листа paper: ${await read('html', '--granum-sheet-paper')}`)
  const withHref = { ...manifest, themes: manifest.themes.map(theme => theme.id === 'paper' ? { ...theme, href: '/never.css' } : theme) }
  const links = await page.evaluate(async (built) => {
    await window.loadThemeSheet(built, 'paper')
    return document.querySelectorAll('link[data-granum-theme]').length
  }, withHref)
  check(links === 0, `загрузчик не поставил ссылку на статически подключённый лист: ${links}`)

  // Дополнительная тема на корне: её пара перекрывает основную, хотя лист стоит раньше общего.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'paper-dark'))
  check(await read('html', '--th-radius') === '6px', `paper-dark на корне: --th-radius: ${await read('html', '--th-radius')}`)
  check(await read('html', '--th-accent') === '#60a5fa', `paper-dark на корне: --th-accent: ${await read('html', '--th-accent')}`)
  await page.evaluate(() => window.themes.setMode('light'))

  // Режим приложения: наследует dark и дописывает своё.
  await page.evaluate(() => window.themes.setMode('ocean'))
  check(await read('html', '--th-fg') === OVERRIDE, `режим приложения ocean: своё значение: ${await read('html', '--th-fg')}`)
  check(await read('html', '--th-bg') === '#0f172a', `режим приложения ocean: унаследовал --th-bg из dark: ${await read('html', '--th-bg')}`)

  // Значение в браузере — то же, что называет `granum tokens`.
  const reported = resolveTokenValue(app.resolution, 'ocean', 'th-fg')
  check(reported === OVERRIDE, `granum tokens называет то же значение ocean: ${reported}`)
}
catch (error) {
  failures.push(`каскад тем и режимов: прогон упал: ${error?.message ?? error}`)
}
finally {
  await browser?.close()
}

/*
 * Ветка фолбэков: `(display: block)` истинно в Chromium и изображает браузер,
 * которому фолбэк нужен. Темы — объекты приложения: каждая проверка видит один
 * случай каскада, а не совокупность данных фикстуры.
 */
const NEEDS_FALLBACK = '(display: block)'
try {
  const theme = (id, ring, modes) => ({ id, title: id, root: { 'fb-ring': `0 0 0 ${ring} var(--fb-accent)` }, modes })
  const light = { colorScheme: 'light', tokens: { 'fb-bg': 'oklch(98% 0 0)', 'fb-fg': '#111111', 'fb-accent': '#2563eb' }, fallbacks: [{ supports: NEEDS_FALLBACK, tokens: { 'fb-bg': '#fafafa' } }] }
  const darkOwn = { colorScheme: 'dark', tokens: { 'fb-bg': '#000000', 'fb-fg': '#eeeeee', 'fb-accent': '#60a5fa' } }
  const darkInherits = { colorScheme: 'dark', tokens: { 'fb-fg': '#eeeeee', 'fb-accent': '#60a5fa' } }
  const darkWithFallback = { colorScheme: 'dark', tokens: { 'fb-bg': 'oklch(20% 0 0)', 'fb-fg': '#eeeeee', 'fb-accent': '#60a5fa' }, fallbacks: [{ supports: NEEDS_FALLBACK, tokens: { 'fb-bg': '#111111' } }] }
  const cssOf = async (config) => {
    const emitted = await emitCss(await prepareApp({ engine: windEngine(), providers: ['@granum-fixtures/themed-ds'], components: [], ...config }, appsRoot))
    return `${emitted.css}\n${Object.values(emitted.themeSheets).join('\n')}`
  }

  browser = await chromium.launch()
  const page = await browser.newPage()
  /** Значение токена на корне или на острове при заданной системной схеме. */
  const valueAt = async (css, { root, island, scheme = 'light' }, token) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.setContent(`<!doctype html><html${root ? ` data-theme="${root}"` : ''}><head><style>${css}</style></head><body>${island ? `<div id="island" data-theme="${island}"></div>` : ''}</body></html>`)
    return page.evaluate(([sel, name]) => getComputedStyle(document.querySelector(sel)).getPropertyValue(name).trim(), [island ? '#island' : 'html', token])
  }
  const expectValue = async (css, at, token, want, what) => {
    const got = await valueAt(css, at, token)
    check(want instanceof RegExp ? want.test(got) : got === want, `${what}: ${token}: ${got}`)
  }

  const own = await cssOf({ themes: [{ theme: theme('t', '2px', { light, dark: darkOwn }), modes: ['light', 'dark'] }] })
  await expectValue(own, { root: 't-dark' }, '--fb-bg', '#000000', 'фолбэк режима по умолчанию не перебивает тёмную пару на корне')
  await expectValue(own, {}, '--fb-bg', '#fafafa', 'корень без атрибута берёт фолбэк режима по умолчанию')

  const inherited = await cssOf({ themes: [{ theme: theme('t', '2px', { light, dark: darkInherits }), modes: ['light', 'dark'] }], activation: { system: 'media' } })
  await expectValue(inherited, { root: 't-dark' }, '--fb-bg', '#fafafa', 'токен, взятый из режима по умолчанию, — с его фолбэком на корне')
  await expectValue(inherited, { root: 't-light', island: 't-dark' }, '--fb-bg', '#fafafa', 'и на острове режима')
  await expectValue(inherited, { scheme: 'dark' }, '--fb-bg', '#fafafa', 'и по системной тёмной схеме')

  const media = await cssOf({ themes: [{ theme: theme('t', '2px', { light, dark: darkWithFallback }), modes: ['light', 'dark'] }], activation: { system: 'media' } })
  await expectValue(media, { scheme: 'dark' }, '--fb-bg', '#111111', 'system: media — корень без атрибута берёт фолбэк тёмного режима')

  const modes = { light, dark: darkOwn }
  const slate = await cssOf({ themes: [{ theme: theme('slate-hc', '3px', modes), default: true }, { theme: theme('slate', '1px', modes), modes: ['light', 'dark'] }] })
  await expectValue(slate, { root: 'slate-hc-light' }, '--fb-ring', /\b3px\b/, 'формулы дополнительной slate не достают корень slate-hc')
  await expectValue(slate, { root: 'slate-hc-light', island: 'slate-dark' }, '--fb-ring', /\b1px\b/, 'остров дополнительной slate — свои формулы')
  await expectValue(slate, { root: 'slate-dark' }, '--fb-ring', /\b1px\b/, 'дополнительная slate на корне — свои формулы')
  const prefixed = await cssOf({ themes: [{ theme: theme('paper', '3px', modes), default: true }, { theme: theme('ink', '1px', modes), modes: ['light', 'dark'] }], activation: { attribute: 'data-theme', value: 'x-{mode}-{theme}' } })
  await expectValue(prefixed, { root: 'x-light-paper' }, '--fb-ring', /\b3px\b/, 'шаблон со статикой перед режимом: формулы дополнительной темы не достают корень')
}
catch (error) {
  failures.push(`ветка фолбэков: прогон упал: ${error?.message ?? error}`)
}
finally {
  await browser?.close()
}

/*
 * Собранный лист стенда против вывода `emitCss` той же конфигурации. Значение
 * токена сравнивается вычисленным: оно подставляется в настоящие свойства, и
 * `#eee` против `#eeeeee` расхождением не считается, а другой цвет — считается.
 * Условие фолбэков подменяется истинным в Chromium — ветка браузера без фичи.
 */
const FALLBACK_CONDITION = /@supports\s+not\s*\(\s*color\s*:\s*color-mix\([^)]*\)\s*\)/g
// Только ненаследуемые свойства: невалидный в них токен даёт начальное значение,
// а не значение родителя — стили страницы стенда (шрифт, цвет текста) не мешают.
const PROBE_PROPERTIES = ['background-color', 'box-shadow', 'padding-left', 'border-top-left-radius']
for (const stand of ['app-theme-ink', 'app-5']) {
  const standRoot = fileURLToPath(new URL(`../apps/${stand}/`, import.meta.url))
  const outDir = mkdtempSync(join(tmpdir(), `granum-e2e-${stand}-`))
  try {
    const { config } = await loadGranumConfigFile('granum.config.ts', standRoot)
    const app = await prepareApp(config, standRoot)
    const out = await emitCss(app)
    const emitted = `${out.css}\n${Object.values(out.themeSheets).join('\n')}`
    await build({ root: standRoot, configFile: join(standRoot, 'vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    const assets = join(outDir, 'assets')
    const built = readdirSync(assets).filter(f => f.endsWith('.css')).map(f => readFileSync(join(assets, f), 'utf8')).join('\n')
    const fallbackOn = css => css.replace(FALLBACK_CONDITION, '@supports (display: block)')
    check(fallbackOn(emitted) !== emitted && fallbackOn(built) !== built, `${stand}: условие фолбэков найдено и в emitCss, и в собранном листе`)

    const tokens = [...new Set([...emitted.matchAll(/(--[a-z][\w-]*)\s*:/g)].map(m => m[1]))].filter(t => !t.startsWith('--un-'))
    const { themes, system } = app.resolution.themes
    const pairs = themes.find(entry => entry.isDefault).modes.map(mode => mode.value)
    const islands = themes.flatMap(entry => entry.modes.map(mode => mode.value))
    const states = [{}, ...pairs.map(root => ({ root })), ...islands.map(island => ({ root: pairs[0], island }))]

    browser = await chromium.launch()
    const page = await browser.newPage()
    const signatures = async (css, { root, island, scheme }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.setContent(`<!doctype html><html${root ? ` data-theme="${root}"` : ''}><head><style>${css}</style></head><body>${island ? `<div id="island" data-theme="${island}"></div>` : ''}</body></html>`)
      return page.evaluate(([selector, names, properties]) => {
        const probe = document.createElement('i')
        document.querySelector(selector).append(probe)
        const out = {}
        for (const name of names) {
          for (const property of properties)
            probe.style.setProperty(property, `var(${name})`)
          const computed = getComputedStyle(probe)
          out[name] = properties.map(property => computed.getPropertyValue(property)).join(' | ')
        }
        return out
      }, [island ? '#island' : 'body', tokens, PROBE_PROPERTIES])
    }

    const diffs = []
    let compared = 0
    for (const state of states) {
      for (const scheme of ['light', 'dark']) {
        for (const withFallback of [false, true]) {
          const fromEmit = await signatures(withFallback ? fallbackOn(emitted) : emitted, { ...state, scheme })
          const fromBuild = await signatures(withFallback ? fallbackOn(built) : built, { ...state, scheme })
          for (const token of tokens) {
            compared++
            if (fromEmit[token] !== fromBuild[token])
              diffs.push(`${JSON.stringify({ ...state, scheme, withFallback })} ${token}: emitCss «${fromEmit[token]}» ≠ сборка «${fromBuild[token]}»`)
          }
        }
      }
    }
    check(diffs.length === 0, `${stand}: каскад собранного листа совпал с emitCss — ${compared} сравнений по ${states.length} состояниям${diffs.length ? `; расхождений ${diffs.length}, первое: ${diffs[0]}` : ''}`)

    // Ветка фолбэков действительно другая: иначе сравнение выше ничего не доказывает.
    const plain = await signatures(built, { root: pairs[0], scheme: 'light' })
    const fallen = await signatures(fallbackOn(built), { root: pairs[0], scheme: 'light' })
    check(tokens.some(token => plain[token] !== fallen[token]), `${stand}: фолбэк меняет значения на корне ${pairs[0]}`)

    // Системная схема: корень без атрибута при тёмной схеме — тот же тёмный режим, что парой.
    if (system === 'media') {
      const dark = themes.find(entry => entry.isDefault).modes.find(mode => mode.colorScheme === 'dark')
      for (const withFallback of [false, true]) {
        const css = withFallback ? fallbackOn(built) : built
        const bySystem = await signatures(css, { scheme: 'dark' })
        const byPair = await signatures(css, { root: dark.value, scheme: 'light' })
        const differ = tokens.filter(token => bySystem[token] !== byPair[token])
        check(differ.length === 0, `${stand}: тёмная схема без атрибута = пара ${dark.value}${withFallback ? ' с фолбэками' : ''}${differ.length ? `; расходятся: ${differ.join(' ')}` : ''}`)
      }
    }
  }
  catch (error) {
    failures.push(`собранный лист ${stand}: прогон упал: ${error?.message ?? error}`)
  }
  finally {
    await browser?.close()
    browser = undefined
    rmSync(outDir, { recursive: true, force: true })
  }
}

/*
 * Пример переключения тем (`apps/app-theme-switch`) на собранной странице: острова
 * в своих темах, выбор темы и режима, режим при смене темы, а после перезагрузки
 * выбор стоит до первого кадра — даже с заблокированным JS приложения: пару и
 * ссылку на лист ставит скрипт в `<head>`.
 */
{
  const stand = fileURLToPath(new URL('../apps/app-theme-switch/', import.meta.url))
  const outDir = mkdtempSync(join(tmpdir(), 'granum-e2e-switch-'))
  try {
    await build({ root: stand, configFile: join(stand, 'vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    browser = await chromium.launch()
    const page = await browser.newPage()
    let blockScripts = false
    await page.route('http://granum.test/**', (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/app-theme-switch\//, '')
      const file = join(outDir, path === '' ? 'index.html' : path)
      if (blockScripts && file.endsWith('.js'))
        return route.abort()
      if (!existsSync(file))
        return route.fulfill({ status: 404, body: '' })
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'
      return route.fulfill({ contentType: type, body: readFileSync(file) })
    })
    const attribute = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    const token = (selector, name) => page.evaluate(([sel, n]) => getComputedStyle(sel === 'html' ? document.documentElement : document.querySelector(sel)).getPropertyValue(n).trim(), [selector, name])
    const waitPair = pair => page.waitForFunction(value => document.documentElement.getAttribute('data-theme') === value, pair, { timeout: 5000 })

    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('http://granum.test/app-theme-switch/')
    await page.waitForSelector('[data-theme-option="ink"]')
    check(await attribute() === 'paper-light', `пример: основная тема на старте: ${await attribute()}`)

    // Острова грузят листы своих тем сами и ставят пару после загрузки.
    await page.waitForFunction(() => document.querySelector('[data-island="sand"]')?.getAttribute('data-theme') === 'sand-dark', undefined, { timeout: 5000 })
    await page.waitForFunction(() => document.querySelector('[data-island="ink"]')?.getAttribute('data-theme') === 'ink-dim', undefined, { timeout: 5000 })
    check(await token('[data-island="sand"]', '--th-radius') === '12px', `пример: остров sand-dark — скругление своей темы: ${await token('[data-island="sand"]', '--th-radius')}`)
    check(await token('[data-island="ink"]', '--th-bg') === '#1e293b', `пример: остров ink-dim — фон режима «Сумерки»: ${await token('[data-island="ink"]', '--th-bg')}`)
    check(await token('html', '--th-radius') === '6px', `пример: корень остался paper: ${await token('html', '--th-radius')}`)

    await page.click('[data-theme-option="ink"]')
    await waitPair('ink-light')
    check(await token('html', '--th-font') === 'Georgia, serif', `пример: тема ink на корне — её шрифт: ${await token('html', '--th-font')}`)
    await page.click('[data-mode-option="dim"]')
    await waitPair('ink-dim')
    check(await token('html', '--th-bg') === '#1e293b', `пример: режим «Сумерки»: ${await token('html', '--th-bg')}`)
    // У «Песка» нет «Сумерек»: берётся первый режим той же схемы — тёмный.
    await page.click('[data-theme-option="sand"]')
    await waitPair('sand-dark')
    check(await attribute() === 'sand-dark', `пример: смена темы переносит схему режима: ${await attribute()}`)

    blockScripts = true
    await page.reload()
    check(await attribute() === 'sand-dark', `пример: после перезагрузки без JS приложения выбор на корне: ${await attribute()}`)
    check(await page.evaluate(() => document.querySelector('link[data-granum-theme="sand"]')?.getAttribute('blocking') === 'render'), 'пример: лист sand поставлен скриптом до первого кадра')
    check(await token('html', '--th-radius') === '12px', `пример: значения sand на корне без JS приложения: ${await token('html', '--th-radius')}`)

    // Лист, вставленный скриптом, стоит после стилей страницы: слой granum
    // объявлен после сброса приложения, и утилиты кнопок сбросу не проигрывают.
    blockScripts = false
    await page.reload()
    await page.waitForSelector('[data-theme-option="sand"]')
    const background = await page.evaluate(() => getComputedStyle(document.querySelector('[data-theme-option="sand"]')).backgroundColor)
    check(background === 'rgb(245, 158, 11)', `пример: после перезагрузки утилиты кнопок не перебиты сбросом приложения: фон ${background}`)
  }
  catch (error) {
    failures.push(`пример переключения тем: прогон упал: ${error?.message ?? error}`)
  }
  finally {
    await browser?.close()
    browser = undefined
    rmSync(outDir, { recursive: true, force: true })
  }
}

/*
 * Тот же пример на dev-сервере: стили приходят из JS уже после ссылки на лист,
 * которую поставил скрипт, и порядок слоёв держит объявление в `<head>` примера.
 */
{
  const stand = fileURLToPath(new URL('../apps/app-theme-switch/', import.meta.url))
  try {
    server = await createServer({
      root: stand,
      configFile: join(stand, 'vite.config.ts'),
      logLevel: 'warn',
      server: { port: 5197, strictPort: true },
    })
    await server.listen()
    const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5197/app-theme-switch/'
    browser = await chromium.launch()
    const page = await browser.newPage()
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto(url)
    await page.waitForSelector('[data-theme-option="sand"]')
    await page.click('[data-theme-option="sand"]')
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'sand-light', undefined, { timeout: 5000 })
    await page.reload()
    await page.waitForSelector('[data-theme-option="sand"]')
    await page.waitForFunction(() => document.querySelector('link[data-granum-theme="sand"]')?.getAttribute('data-granum-state') === 'load', undefined, { timeout: 5000 })
    const background = await page.evaluate(() => getComputedStyle(document.querySelector('[data-theme-option="sand"]')).backgroundColor)
    check(background === 'rgb(180, 83, 9)', `пример в dev: после перезагрузки утилиты кнопок не перебиты сбросом приложения: фон ${background}`)
  }
  catch (error) {
    failures.push(`пример переключения тем в dev: прогон упал: ${error?.message ?? error}`)
  }
  finally {
    await browser?.close()
    browser = undefined
    await server?.close()
    server = undefined
  }
}

/*
 * Значения компонентов у темы (`apps/app-theme-values`, ADR-13) на собранной
 * странице: тема из отдельного пакета (`tide`) выбирается, как тема каталога, —
 * лист грузится, у карточки значение из раздела темы, а не пакета компонентов; у
 * кнопки — значение, унаследованное от «Камня»; выбор переживает перезагрузку.
 */
{
  const stand = fileURLToPath(new URL('../apps/app-theme-values/', import.meta.url))
  const outDir = mkdtempSync(join(tmpdir(), 'granum-e2e-values-'))
  try {
    await build({ root: stand, configFile: join(stand, 'vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    browser = await chromium.launch()
    const page = await browser.newPage()
    await page.route('http://granum.test/**', (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/app-theme-values\//, '')
      const file = join(outDir, path === '' ? 'index.html' : path)
      if (!existsSync(file))
        return route.fulfill({ status: 404, body: '' })
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'
      return route.fulfill({ contentType: type, body: readFileSync(file) })
    })
    const attribute = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    const style = (selector, property) => page.evaluate(([sel, prop]) => getComputedStyle(document.querySelector(sel))[prop], [selector, property])

    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('http://granum.test/app-theme-values/')
    await page.waitForSelector('[data-theme-option="tide"]')
    check(await style('[data-card]', 'backgroundColor') === 'rgb(245, 245, 244)', `значения у темы: карточка stone по разделу темы: ${await style('[data-card]', 'backgroundColor')}`)

    await page.click('[data-theme-option="tide"]')
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'tide-light', undefined, { timeout: 5000 })
    check(await style('[data-card]', 'backgroundColor') === 'rgb(236, 254, 255)', `значения у темы: карточка tide — значение пакета темы: ${await style('[data-card]', 'backgroundColor')}`)
    check(await style('[data-theme-option="tide"]', 'backgroundColor') === 'rgb(14, 116, 144)', `значения у темы: кнопка tide — значение stone от своего акцента: ${await style('[data-theme-option="tide"]', 'backgroundColor')}`)

    await page.reload()
    await page.waitForSelector('[data-theme-option="tide"]')
    check(await attribute() === 'tide-light', `значения у темы: после перезагрузки выбор на корне: ${await attribute()}`)
    check(await style('[data-card]', 'backgroundColor') === 'rgb(236, 254, 255)', `значения у темы: после перезагрузки карточка tide: ${await style('[data-card]', 'backgroundColor')}`)
  }
  catch (error) {
    failures.push(`значения компонентов у темы: прогон упал: ${error?.message ?? error}`)
  }
  finally {
    await browser?.close()
    browser = undefined
    rmSync(outDir, { recursive: true, force: true })
  }
}

process.stdout.write(`e2e-dev (apps/app-1, apps/app-5, тема ink с режимами и дополнительная paper, ветка фолбэков, собранные листы app-theme-ink и app-5, пример переключения тем на сборке и в dev, значения компонентов у темы)\n  ${steps.join('\n  ')}\n`)
process.stdout.write(failures.length === 0
  ? '✓ слои, HMR, режимы, дополнительные темы, фолбэки и собранные листы подтверждены в браузере\n'
  : `✗ Находок: ${failures.length}\n  - ${failures.join('\n  - ')}\n`)
process.exitCode = failures.length === 0 ? 0 : 1
