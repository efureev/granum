#!/usr/bin/env node
/**
 * Сверка стенда серверного рендера (`apps/app-ssr`).
 *
 * Отдельный скрипт, а не `verify-app.mjs`, по одной причине: у SSR-приложения
 * два дистрибутива (`dist/client` и `dist/server`), и главное утверждение здесь
 * не «в CSS есть такая подстрока», а «сервер отдал такой HTML». Поэтому стенд
 * не читает исходники, а импортирует собранный серверный бандл и рендерит им.
 *
 * Что проверяется и почему именно это:
 *
 *   1. `@feugene/granum/runtime` живёт в Node без DOM. Точка входа объявлена
 *      браузерной (INV-BND-1), но «браузерная» не значит «падает на сервере»:
 *      контроллер тем обязан конструироваться и отвечать на вопросы, просто
 *      применять ему нечего.
 *   2. Тему выбирает сервер, и выбор виден в разметке. Знание о селекторах тем
 *      есть только у сборки, и приезжает оно манифестом `virtual:granum/themes`
 *      — тем же, из которого потом работает браузер.
 *   3. Первый клиентский кадр совпадает с серверным. Клиент не выбирает тему
 *      заново, а читает уже применённую: `readActiveTheme` + контроллер поверх
 *      неё оставляют корень ровно в том состоянии, в каком его отдал сервер.
 *      Это и есть отсутствие вспышки чужой темы, проверенное без браузера.
 *   4. Весь CSS приложения — один ассет с пятью слоями. Для SSR это важнее, чем
 *      кажется: собирать стили по отрендеренным модулям не нужно, достаточно
 *      ссылки из шаблона.
 *   5. Селекция, обрезка токенов и диагностика ведут себя как в обычной сборке:
 *      серверный рендер их не обманывает.
 *
 * Запуск: `yarn workspace @granum-apps/app-ssr verify` (после `yarn build`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { auditFailure } from './audit-dist.mjs'

const dir = process.cwd()
const client = join(dir, 'dist', 'client')
const server = join(dir, 'dist', 'server', 'entry-server.js')

if (!existsSync(server) || !existsSync(client)) {
  console.error(`verify-ssr: нет ${server} или ${client} — сначала \`yarn build\``)
  process.exit(1)
}

const expected = (await import(pathToFileURL(join(dir, 'expected.mjs')).href)).default
const failures = []
const check = (ok, message) => {
  if (!ok)
    failures.push(message)
}

// 1. Рантайм в Node (INV-THM-9) -----------------------------------------------

check(globalThis.document === undefined, 'в окружении проверки есть document — тогда она ничего не доказывает про SSR')

const ssr = await import(pathToFileURL(server).href)
for (const name of ['render', 'ROOT_TAG', 'themeManifest', 'readActiveTheme', 'rootAttributes'])
  check(ssr[name] !== undefined, `серверный бандл не экспортирует ${name}`)

const manifest = ssr.themeManifest
check(
  manifest.themes.map(t => t.name).join(',') === expected.themes.join(','),
  `темы манифеста: ${manifest.themes.map(t => t.name)}, ожидались ${expected.themes}`,
)

// 2. Шаблон и подстановка ------------------------------------------------------

const template = readFileSync(join(client, 'index.html'), 'utf8')
check(
  template.includes(ssr.ROOT_TAG),
  `в dist/client/index.html нет литерала ROOT_TAG (${ssr.ROOT_TAG}) — подстановка темы на корень молча перестала бы работать`,
)
check(template.includes('<!--app-html-->'), 'в шаблоне нет места для разметки приложения')

// 3. Рендер ---------------------------------------------------------------------

const rendered = {}
for (const [key, url] of Object.entries(expected.render))
  rendered[key] = await ssr.render(url)

for (const [key, want] of Object.entries(expected.expectRender)) {
  const got = rendered[key]
  check(got.theme === want.theme, `${key}: активная тема ${got.theme}, ожидалась ${want.theme}`)
  check(got.rootTag === want.rootTag, `${key}: корневой тег ${JSON.stringify(got.rootTag)}, ожидался ${JSON.stringify(want.rootTag)}`)
  for (const fragment of want.html ?? [])
    check(got.html.includes(fragment), `${key}: в разметке нет ${JSON.stringify(fragment)}`)
  for (const fragment of want.htmlAbsent ?? [])
    check(!got.html.includes(fragment), `${key}: в разметке есть лишнее ${JSON.stringify(fragment)}`)
}

// Детерминизм: тот же запрос даёт ту же разметку. Без этого кеш ответов и
// сравнение снапшотов бессмысленны (INV-DET-2).
const again = await ssr.render(expected.render.light)
check(again.html === rendered.light.html, 'повторный рендер того же URL дал другую разметку')
check(again.rootTag === rendered.light.rootTag, 'повторный рендер дал другой корневой тег')

// 4. Совпадение серверного и первого клиентского кадра (INV-THM-7, INV-THM-8) --

/**
 * Заглушка корня: ровно то, что умеет настоящий `documentElement`, и ничего
 * сверх. Хранит состояние, чтобы было видно, менял ли его контроллер.
 */
function makeRoot(rootTag) {
  const attributes = new Map()
  for (const [, name, value] of rootTag.matchAll(/([\w-]+)="([^"]*)"/g)) {
    if (name !== 'lang')
      attributes.set(name, value)
  }
  const classes = new Set((attributes.get('class') ?? '').split(/\s+/).filter(Boolean))
  return {
    attributes,
    classList: {
      add: token => classes.add(token),
      remove: token => classes.delete(token),
      contains: token => classes.has(token),
    },
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
  }
}

const { createThemeController } = await import('@feugene/granum/runtime')

for (const [key, want] of Object.entries(expected.expectRender)) {
  const root = makeRoot(rendered[key].rootTag)
  const before = JSON.stringify([...root.attributes].sort())

  // Ровно то, что делает `entry-client.ts`: читает применённую тему и
  // поднимает контроллер поверх неё.
  const read = ssr.readActiveTheme(manifest, root)
  check(read === want.theme, `${key}: клиент прочитал бы тему ${read}, сервер отдал ${want.theme}`)

  const controller = createThemeController(manifest, { target: root, storage: null, initial: read })
  check(controller.get() === want.theme, `${key}: контроллер стартовал с темой ${controller.get()}, а не ${want.theme}`)
  check(
    JSON.stringify([...root.attributes].sort()) === before,
    `${key}: старт контроллера изменил корень — это и есть вспышка чужой темы при гидрации`,
  )

  // И наоборот: переключение действительно меняет состояние, то есть проверка
  // выше не проходит просто потому, что контроллер ничего не умеет.
  const other = manifest.themes.map(t => t.name).find(name => name !== want.theme)
  controller.set(other)
  check(
    JSON.stringify([...root.attributes].sort()) !== before,
    `${key}: переключение на ${other} не изменило корень`,
  )
  check(ssr.readActiveTheme(manifest, root) === other, `${key}: после переключения корень не читается как ${other}`)
}

// 5. Один ассет CSS и его содержимое --------------------------------------------

const assets = join(client, 'assets')
const cssFiles = readdirSync(assets).filter(name => name.endsWith('.css'))
check(cssFiles.length === 1, `ассетов CSS ${cssFiles.length}, ожидался один: серверу незачем собирать стили по модулям`)
const css = cssFiles.map(name => readFileSync(join(assets, name), 'utf8')).join('\n')
for (const name of cssFiles)
  check(template.includes(name), `шаблон не ссылается на ${name}`)

/*
 * Порядок слоёв проверяется по самим блокам, а не по строке объявления:
 * когда непусты все пять, отдельного `@layer a, b, c;` в выводе нет и быть не
 * должно — порядок задаёт последовательность блоков.
 */
const layerOrder = [...css.matchAll(/@layer granum\.([a-z]+)\{/g)].map(m => m[1])
check(
  layerOrder.join(',') === expected.css.layerOrder.join(','),
  `порядок слоёв ${layerOrder.join(',')}, ожидался ${expected.css.layerOrder.join(',')}`,
)

for (const item of expected.css.present)
  check(css.includes(item.css), `в CSS нет: ${item.what}\n      искали: ${JSON.stringify(item.css)}`)
for (const item of expected.css.absent)
  check(!css.includes(item.css), `в CSS есть лишнее: ${item.what}\n      нашли: ${JSON.stringify(item.css)}`)

// 6. Отчёт сборки и доктор -------------------------------------------------------

const report = JSON.parse(readFileSync(join(client, 'granum-report.json'), 'utf8'))
expected.report(report, (ok, message) => check(ok, `отчёт: ${message}`))

const bin = createRequire(join(dir, 'package.json')).resolve('@feugene/granum/package.json').replace(/package\.json$/, 'dist/bin.js')
const doctor = spawnSync(process.execPath, [bin, 'doctor', 'granum.config.ts', '--json'], { cwd: dir, encoding: 'utf8' })
if (doctor.status !== 0) {
  failures.push(`granum doctor завершился кодом ${doctor.status}:\n${doctor.stderr || doctor.stdout}`)
}
else {
  const counted = {}
  for (const diagnostic of JSON.parse(doctor.stdout).diagnostics)
    counted[diagnostic.code] = (counted[diagnostic.code] ?? 0) + 1
  const declared = expected.doctor?.warnings ?? {}
  for (const code of [...new Set([...Object.keys(counted), ...Object.keys(declared)])].sort())
    check((counted[code] ?? 0) === (declared[code] ?? 0), `doctor: находок \`${code}\` — ${counted[code] ?? 0}, объявлено ${declared[code] ?? 0}`)
}

// Аудит по клиентскому дистрибутиву: в браузер едет именно он, а корень для
// резолва манифестов — каталог стенда, а не `dist/client`.
const audit = auditFailure(dir, ['dist/client', '--root=.'])
if (audit)
  failures.push(audit)

const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
if (failures.length > 0) {
  console.error(`verify-ssr: ✗ ${name} — ${expected.purpose}\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log(`verify-ssr: ✓ ${name} — ${expected.purpose}`)
