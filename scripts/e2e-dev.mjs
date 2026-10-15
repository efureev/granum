#!/usr/bin/env node
/**
 * e2e на dev-сервере: INV-CSS-6 и AC-9 — единственные два утверждения, которые
 * нельзя проверить ни снапшотом CSS, ни отчётом сборки.
 *
 *   INV-CSS-6 — утилита приложения перебивает базовый стиль компонента.
 *     Проверяется вычисленным стилем в браузере: порядок слоёв каскада
 *     подтверждает только сам каскад, а не текст файла.
 *   AC-9 — правка исходника приложения обновляет слой `utilities` по HMR,
 *     без перезагрузки страницы. Отсутствие перезагрузки — тоже наблюдаемый
 *     факт: маркер, положенный в `window`, обязан пережить обновление.
 *
 * Стенд — `apps/app-1`: один компонент с собственным `gap` из слоя
 * `components` и утилита `gap-0` из слоя `utilities`, дописываемая в разметку
 * на ходу.
 *
 * Второй стенд — `apps/app-5` (A-16): он импортирует `virtual:granum/themes`,
 * JS-модуль без границы HMR. Правка разметки его код не меняет и не обязана
 * его перезагружать — иначе обновление поднимается до входа приложения, и Vite
 * перезагружает страницу.
 *
 * Третий сценарий — каскад тем (INV-THM-2): `tokenOverrides` к теме, которую
 * провайдер поставил файлом (`@granum-fixtures/mini-ds`), обязан менять вычисленное
 * значение токена под активной темой и не задевать соседнюю.
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
import { emitCss, prepareApp } from '@feugene/granum/node'
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
 * Каскад тем: override тёмной темы, поставленной файлом, побеждает файл.
 * Страница — один CSS сборки, без dev-сервера: проверяется каскад, а не HMR.
 */
const OVERRIDE = '#4fd1e0'
try {
  const app = await prepareApp({
    engine: windEngine(),
    providers: ['@granum-fixtures/mini-ds'],
    themes: { names: ['light', 'dark'], tokenOverrides: { dark: { 'xxx-bg': OVERRIDE } } },
  }, fileURLToPath(new URL('../apps/app-components/', import.meta.url)))
  const { css } = await emitCss(app)

  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body></body></html>`)
  const bg = activate => page.evaluate((how) => {
    const root = document.documentElement
    root.removeAttribute('data-theme')
    root.classList.remove('dark')
    if (how === 'attribute')
      root.setAttribute('data-theme', 'dark')
    if (how === 'class')
      root.classList.add('dark')
    return getComputedStyle(root).getPropertyValue('--xxx-bg').trim()
  }, activate)

  const light = await bg('none')
  const byAttribute = await bg('attribute')
  const byClass = await bg('class')
  check(byAttribute === OVERRIDE, `тёмная тема-файл: override действует под [data-theme=dark]: ${byAttribute}`)
  check(byClass === OVERRIDE, `тёмная тема-файл: override действует под .dark: ${byClass}`)
  check(light === '#ffffff', `светлая тема не задета override тёмной: ${light}`)
}
catch (error) {
  failures.push(`каскад тем: прогон упал: ${error?.message ?? error}`)
}
finally {
  await browser?.close()
}

process.stdout.write(`e2e-dev (apps/app-1, apps/app-5, тема-файл mini-ds)\n  ${steps.join('\n  ')}\n`)
process.stdout.write(failures.length === 0
  ? '✓ INV-CSS-6, AC-9, A-16 и INV-THM-2 подтверждены в браузере\n'
  : `✗ Находок: ${failures.length}\n  - ${failures.join('\n  - ')}\n`)
process.exitCode = failures.length === 0 ? 0 : 1
