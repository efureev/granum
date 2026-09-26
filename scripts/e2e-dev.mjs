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
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../apps/app-1/', import.meta.url))
const appSource = join(root, 'src/App.vue')
const original = readFileSync(appSource, 'utf8')

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

process.stdout.write(`e2e-dev (apps/app-1)\n  ${steps.join('\n  ')}\n`)
process.stdout.write(failures.length === 0
  ? '✓ INV-CSS-6 и AC-9 подтверждены в браузере\n'
  : `✗ Находок: ${failures.length}\n  - ${failures.join('\n  - ')}\n`)
process.exitCode = failures.length === 0 ? 0 : 1
