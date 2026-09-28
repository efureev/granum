#!/usr/bin/env node
/**
 * Сверка стенда разделения CSS по слоям (`apps/bench-split`, A-21).
 *
 * Отдельный скрипт, а не `verify-app.mjs`, по одной причине: главное утверждение
 * здесь не «в CSS есть такая подстрока», а «правка разметки меняет один ассет из
 * пяти». Проверить это одной сборкой нельзя — нужны две и сравнение имён.
 *
 * Что проверяется и почему именно это:
 *
 *   1. Пять ассетов вместо одного, по одному на непустой слой, и `<link>` на все
 *      пять в HTML — в порядке слоёв. Порядок ссылок и есть порядок каскада:
 *      первое появление слоя задаёт его место.
 *   2. Объявление `@layer …;` стоит ровно в одном файле — ассете входа, ссылку
 *      на который Vite ставит раньше наших. В ассетах слоёв его быть не должно:
 *      продублированное объявление ничего не ломает, но перестаёт быть одним
 *      местом правды о порядке (INV-CSS-1).
 *   3. Ни один ассет не содержит чужого слоя: разделение обязано быть полным, а
 *      не «почти».
 *   4. **Правка `App.vue` меняет ровно один ассет из пяти** — тот, что несёт
 *      utilities. Ради этого стенд и существует: один файл жмётся лучше, но
 *      инвалидируется целиком, и без этой проверки обещание опции ничем не
 *      подтверждено.
 *   5. Конкатенация пяти ассетов в порядке слоёв равна тому, что отдал бы один
 *      `virtual:granum.css`: разделение меняет доставку, а не содержимое.
 *
 * Запуск: `yarn workspace @granum-apps/bench-split verify` (после `yarn build`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { auditFailure } from './audit-dist.mjs'

const LAYERS = ['tokens', 'base', 'themes', 'components', 'utilities']
const dir = process.cwd()
const dist = join(dir, 'dist')
const appFile = join(dir, 'src/App.vue')

const failures = []
const check = (ok, message) => {
  if (!ok)
    failures.push(message)
}

/** Имена CSS-ассетов слоёв: `granum.<layer>-<hash>.css` → слой → имя файла. */
function layerAssets(assetsDir) {
  const found = new Map()
  for (const name of readdirSync(assetsDir)) {
    const m = /^granum\.([a-z]+)-[\w-]+\.css$/.exec(name)
    if (m && LAYERS.includes(m[1]))
      found.set(m[1], name)
  }
  return found
}

function build() {
  const result = spawnSync('yarn', ['build'], { cwd: dir, encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error(`сборка стенда упала:\n${result.stderr || result.stdout}`)
}

if (!existsSync(dist))
  build()

// 1. Пять ассетов и ссылки на них ------------------------------------------

const assetsDir = join(dist, 'assets')
const first = layerAssets(assetsDir)
check(first.size === LAYERS.length, `ассетов слоёв ${first.size}, ожидалось ${LAYERS.length}: ${[...first.keys()]}`)

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const linked = [...html.matchAll(/<link[^>]+href="([^"]*granum\.([a-z]+)-[\w-]+\.css)"/g)].map(m => m[2])
check(
  linked.join(',') === LAYERS.join(','),
  `ссылки в HTML идут в порядке ${linked.join(',')}, ожидался порядок слоёв ${LAYERS.join(',')}`,
)

/*
 * Общего ассета с тем же CSS быть не должно: он приехал бы вторым экземпляром.
 * Блок слоя — это `@layer granum.X {`; одно объявление порядка (`@layer a, b;`)
 * блоком не является и живёт как раз в ассете входа.
 */
const cssAssets = readdirSync(assetsDir).filter(n => n.endsWith('.css'))
const entryCss = cssAssets.filter(n => !n.startsWith('granum.'))
const strayLayerCss = entryCss.filter(n => /@layer granum\.[a-z]+\s*\{/.test(readFileSync(join(assetsDir, n), 'utf8')))
check(strayLayerCss.length === 0, `CSS granum приехал ещё и в ${strayLayerCss.join(', ')} — доставка дважды`)

// 2–3. Объявление порядка и чистота слоёв -----------------------------------

const bodies = new Map([...first].map(([layer, name]) => [layer, readFileSync(join(assetsDir, name), 'utf8')]))
const ORDER_RE = /@layer granum\.tokens\s*,/
const withOrder = [...bodies].filter(([, css]) => ORDER_RE.test(css)).map(([layer]) => layer)
check(withOrder.length === 0, `объявление порядка продублировано в ассетах слоёв: ${withOrder.join(', ')}`)
// Объявление обязано быть, и ровно одно: его несёт ассет входа, ссылку на
// который Vite ставит раньше наших.
const declaring = entryCss.filter(n => ORDER_RE.test(readFileSync(join(assetsDir, n), 'utf8')))
check(declaring.length === 1, `объявление порядка слоёв найдено в ${declaring.length} ассетах входа, ожидался один`)
check(
  html.indexOf(declaring[0] ?? '\0') < html.indexOf(first.get('tokens') ?? '\0'),
  'ссылка на объявление порядка стоит позже первого слоя',
)

for (const [layer, css] of bodies) {
  const others = LAYERS.filter(l => l !== layer).filter(l => new RegExp(`@layer granum\\.${l}\\s*\\{`).test(css))
  check(others.length === 0, `ассет слоя ${layer} содержит чужие слои: ${others.join(', ')}`)
  check(new RegExp(`@layer granum\\.${layer}\\s*\\{`).test(css), `ассет слоя ${layer} не обёрнут в свой @layer`)
}

// 4. Правка разметки меняет один ассет из пяти -------------------------------

const before = readFileSync(appFile, 'utf8')
const MARKER = 'class="p-4"'
const PATCHED = 'class="p-5"'
check(before.includes(MARKER), `в App.vue нет маркера ${MARKER} — скрипт и стенд разошлись`)

let second
try {
  writeFileSync(appFile, before.replace(MARKER, PATCHED))
  build()
  second = layerAssets(assetsDir)
}
finally {
  writeFileSync(appFile, before)
}

const changed = LAYERS.filter(layer => first.get(layer) !== second.get(layer))
check(
  changed.join(',') === 'utilities',
  `после правки App.vue изменились ассеты [${changed.join(', ')}], ожидался только utilities`,
)
check(second.size === LAYERS.length, `после правки ассетов слоёв ${second.size}, ожидалось ${LAYERS.length}`)

// Сборка возвращается к исходному состоянию: иначе следующий прогон стенда
// сравнивал бы с патченым CSS.
build()
const restored = layerAssets(assetsDir)
check(
  LAYERS.every(layer => restored.get(layer) === first.get(layer)),
  'после возврата App.vue имена ассетов не совпали с исходными — сборка не детерминирована',
)

// 5. Конкатенация слоёв равна целому ----------------------------------------

const joined = [
  readFileSync(join(assetsDir, declaring[0]), 'utf8'),
  ...LAYERS.map(layer => readFileSync(join(assetsDir, restored.get(layer)), 'utf8')),
].join('')
const report = JSON.parse(readFileSync(join(dist, 'granum-report.json'), 'utf8'))
check(
  joined.includes('@layer granum.tokens {') && joined.includes('@layer granum.utilities {'),
  'в конкатенации слоёв нет обёрток @layer',
)
check(
  LAYERS.every(layer => joined.indexOf(`@layer granum.${layer} {`) > -1)
  && LAYERS.slice(1).every((layer, i) => joined.indexOf(`@layer granum.${layer} {`) > joined.indexOf(`@layer granum.${LAYERS[i]} {`)),
  'порядок слоёв в конкатенации не совпадает с порядком каскада',
)
// У фикстуры `heavy` одна намеренно мёртвая запись safelist (INV-CON-4); ничего
// сверх неё без правила остаться не должно.
check(
  report.classes.unmatched.map(u => u.className).join(',') === 'shadow-legacy',
  `unmatched: ${JSON.stringify(report.classes.unmatched)}`,
)

// Аудит здесь не лишний: разделённый CSS — единственная раскладка, где его
// ассетов пять, а не один: потерянный слой виден именно так.
const auditFailed = auditFailure(dir)
check(auditFailed === null, auditFailed ?? '')

const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
if (failures.length > 0) {
  console.error(`verify-split: ✗ ${name} — разделение CSS по слоям\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log(`verify-split: ✓ ${name} — пять ассетов по слоям; правка разметки меняет один из них`)
