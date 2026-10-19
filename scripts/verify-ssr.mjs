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
 *      браузерной, но «браузерная» не значит «падает на сервере»:
 *      контроллер режимов обязан конструироваться и отвечать на вопросы,
 *      просто применять ему нечего.
 *   2. Режим выбирает сервер — из запроса или cookie — и пишет пару на корень.
 *      Значения пар есть только у сборки, и приезжают они манифестом
 *      `virtual:granum/themes` — тем же, из которого потом работает браузер.
 *   3. Первый клиентский кадр совпадает с серверным. Клиент не выбирает режим
 *      заново: контроллер узнаёт выставленную пару и оставляет корень ровно в
 *      том состоянии, в каком его отдал сервер. Это и есть отсутствие вспышки
 *      чужого режима, проверенное без браузера.
 *   4. Весь CSS приложения — один ассет с пятью слоями. Для SSR это важнее, чем
 *      кажется: собирать стили по отрендеренным модулям не нужно, достаточно
 *      ссылки из шаблона.
 *   5. Селекция, обрезка токенов и диагностика ведут себя как в обычной сборке:
 *      серверный рендер их не обманывает.
 *   6. Провайдеры, вынесенные во внешние, грузятся без granum: так их
 *      грузит сервер, задеплоенный с `--omit=dev`, где granum — devDependency
 *      приложения. Хук разрешения модулей запрещает `dist` провайдера
 *      импортировать `@feugene/granum`.
 *
 * Запуск: `yarn workspace @granum-apps/app-ssr verify` (после `yarn build`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
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

// 1. Рантайм в Node -----------------------------------------------

check(globalThis.document === undefined, 'в окружении проверки есть document — тогда она ничего не доказывает про SSR')

// 6. Провайдеры без granum — до загрузки серверного бандла -------------------

const serverImports = [...readFileSync(server, 'utf8').matchAll(/from\s*"([^"]+)"/g)].map(m => m[1])
for (const provider of expected.externalProviders) {
  check(
    serverImports.some(spec => spec === provider || spec.startsWith(`${provider}/`)),
    `серверный бандл не импортирует ${provider} извне — провайдер встроен, и проверка ниже ничего не доказывает`,
  )
}
const granumFromProvider = []
registerHooks({
  resolve(specifier, context, nextResolve) {
    // Провайдеры — фикстуры воркспейса; Node видит их по реальному пути.
    if (/^@feugene\/granum(?:\/|$)/.test(specifier) && context.parentURL?.includes('/fixtures/')) {
      granumFromProvider.push(`${specifier} ← ${context.parentURL}`)
      const error = new Error(`Cannot find package '@feugene/granum' imported from ${context.parentURL} (granum is a devDependency of the app, absent after --omit=dev)`)
      error.code = 'ERR_MODULE_NOT_FOUND'
      throw error
    }
    return nextResolve(specifier, context)
  },
})

let ssr
try {
  ssr = await import(pathToFileURL(server).href)
}
catch (error) {
  console.error(`verify-ssr: ✗ серверный бандл не загрузился: ${error.message}`)
  process.exit(1)
}
check(granumFromProvider.length === 0, `dist провайдера импортирует granum в рантайме: ${granumFromProvider.join('; ')}`)
for (const name of ['render', 'ROOT_TAG', 'themeManifest', 'readActiveMode', 'rootAttributes'])
  check(ssr[name] !== undefined, `серверный бандл не экспортирует ${name}`)

const manifest = ssr.themeManifest
check(manifest.theme.id === expected.theme, `тема манифеста: ${manifest.theme.id}, ожидалась ${expected.theme}`)
const pairs = Object.fromEntries(manifest.modes.map(mode => [mode.name, mode.value]))
check(JSON.stringify(pairs) === JSON.stringify(expected.modes), `режимы манифеста: ${JSON.stringify(pairs)}, ожидались ${JSON.stringify(expected.modes)}`)

// 2. Шаблон и подстановка ------------------------------------------------------

const template = readFileSync(join(client, 'index.html'), 'utf8')
check(
  template.includes(ssr.ROOT_TAG),
  `в dist/client/index.html нет литерала ROOT_TAG (${ssr.ROOT_TAG}) — подстановка темы на корень молча перестала бы работать`,
)
check(template.includes('<!--app-html-->'), 'в шаблоне нет места для разметки приложения')

// 3. Рендер ---------------------------------------------------------------------

const rendered = {}
for (const [key, request] of Object.entries(expected.render))
  rendered[key] = await ssr.render(request.url, request.cookie)

for (const [key, want] of Object.entries(expected.expectRender)) {
  const got = rendered[key]
  check(got.mode === want.mode, `${key}: активный режим ${got.mode}, ожидался ${want.mode}`)
  check(got.rootTag === want.rootTag, `${key}: корневой тег ${JSON.stringify(got.rootTag)}, ожидался ${JSON.stringify(want.rootTag)}`)
  for (const fragment of want.html ?? [])
    check(got.html.includes(fragment), `${key}: в разметке нет ${JSON.stringify(fragment)}`)
  for (const fragment of want.htmlAbsent ?? [])
    check(!got.html.includes(fragment), `${key}: в разметке есть лишнее ${JSON.stringify(fragment)}`)
}

// Детерминизм: тот же запрос даёт ту же разметку. Без этого кеш ответов и
// сравнение снапшотов бессмысленны.
const again = await ssr.render(expected.render.light.url)
check(again.html === rendered.light.html, 'повторный рендер того же URL дал другую разметку')
check(again.rootTag === rendered.light.rootTag, 'повторный рендер дал другой корневой тег')

// 4. Совпадение серверного и первого клиентского кадра --

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

  // Ровно то, что делает `entry-client.ts`: контроллер поднимается поверх
  // уже выставленной пары и узнаёт её сам.
  const read = ssr.readActiveMode(manifest, root)
  check(read === want.mode, `${key}: клиент прочитал бы режим ${read}, сервер отдал ${want.mode}`)

  const controller = createThemeController(manifest, { target: root, storage: null })
  check(controller.mode === want.mode, `${key}: контроллер стартовал с режимом ${controller.mode}, а не ${want.mode}`)
  check(
    JSON.stringify([...root.attributes].sort()) === before,
    `${key}: старт контроллера изменил корень — это и есть вспышка чужой темы при гидрации`,
  )

  // И наоборот: переключение действительно меняет состояние, то есть проверка
  // выше не проходит просто потому, что контроллер ничего не умеет.
  const other = manifest.modes.map(m => m.name).find(name => name !== want.mode)
  controller.setMode(other)
  check(
    JSON.stringify([...root.attributes].sort()) !== before,
    `${key}: переключение на ${other} не изменило корень`,
  )
  check(ssr.readActiveMode(manifest, root) === other, `${key}: после переключения корень не читается как ${other}`)
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
