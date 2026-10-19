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
 * пересчитывают значения и формулы на своём элементе, превью другой темы не
 * задевает корень, а значение в браузере совпадает с `granum tokens`.
 *
 * Правка исходника откатывается в `finally` при любом исходе: файл рабочего
 * дерева, и оставить его изменённым нельзя.
 *
 * Запуск: `yarn e2e` (в CI — своя джоба; в `test:all` не входит, чтобы
 * локальный прогон не тянул браузер).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { resolveTokenValue } from '@feugene/granum'
import { emitCss, getThemeManifest, prepareApp } from '@feugene/granum/node'
import { windEngine } from '@feugene/granum-engine-wind'
import { chromium } from 'playwright'
import { createServer } from 'vite'

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
 * режима и превью другой темы пересчитывают значения на своём элементе.
 * Страница — один CSS сборки, без dev-сервера: проверяется каскад, а не HMR.
 */
const OVERRIDE = '#4fd1e0'
const appsRoot = fileURLToPath(new URL('../apps/app-components/', import.meta.url))
try {
  const app = await prepareApp({
    engine: windEngine(),
    providers: ['@granum-fixtures/themed-ds'],
    theme: 'ink',
    previews: ['paper'],
    modes: { define: { ocean: { extends: 'dark', colorScheme: 'dark', tokens: { 'th-fg': OVERRIDE } } }, tokenOverrides: { dark: { 'th-line': '#123456' } } },
  }, appsRoot)
  const { css } = await emitCss(app)

  // Манифест — пары активной темы; от селекции компонентов он не зависит.
  const pairsOf = manifest => manifest.modes.map(mode => mode.value).join(',')
  const manifest = getThemeManifest(app.resolution)
  check(pairsOf(manifest) === 'ink-light,ink-dark,ink-dim,ink-ocean', `пары манифеста: ${pairsOf(manifest)}`)
  const bare = await prepareApp({ engine: windEngine(), providers: ['@granum-fixtures/themed-ds'], components: [], theme: 'ink', modes: { define: { ocean: { extends: 'dark' } } } }, appsRoot)
  check(pairsOf(getThemeManifest(bare.resolution)) === pairsOf(manifest), `пары манифеста при селекции []: ${pairsOf(getThemeManifest(bare.resolution))}`)

  // Страница с CSS сборки и собранным `@feugene/granum/runtime`: файлы `dist` отдаёт route.
  const runtimeDir = fileURLToPath(new URL('../packages/granum/dist/', import.meta.url))
  const body = '<div id="island" data-theme="ink-dark"><div id="nested" data-theme="ink-dim"></div></div>'
    + '<div id="preview" data-theme="paper-dark"></div>'
  const html = `<!doctype html><html><head><style>${css}</style></head><body>${body}<script type="module">`
    + `import { createThemeController } from '/runtime.js';`
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

  // Превью другой темы: полный блок своей пары, корень не задет.
  check(await read('#preview', '--th-radius') === '6px', `превью paper-dark: свой --th-radius: ${await read('#preview', '--th-radius')}`)
  check(await read('#preview', '--th-accent') === '#60a5fa', `превью paper-dark: --th-accent: ${await read('#preview', '--th-accent')}`)
  check(await read('html', '--th-radius') === '2px', `корень остался ink: --th-radius: ${await read('html', '--th-radius')}`)

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

process.stdout.write(`e2e-dev (apps/app-1, apps/app-5, тема ink с режимами и превью paper)\n  ${steps.join('\n  ')}\n`)
process.stdout.write(failures.length === 0
  ? '✓ слои, HMR, режимы и превью подтверждены в браузере\n'
  : `✗ Находок: ${failures.length}\n  - ${failures.join('\n  - ')}\n`)
process.exitCode = failures.length === 0 ? 0 : 1
