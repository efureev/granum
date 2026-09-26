#!/usr/bin/env node
/**
 * Вендоринг ядра UnoCSS в `packages/granum-engine-mini/src/vendor/` (ADR-2, E-8).
 *
 * Источник — собранные `dist` четырёх пакетов из `node_modules`, версия
 * зафиксирована в `VENDOR_VERSION` и обязана совпадать с devDependencies.
 * Скрипт детерминирован и идемпотентен: каталог очищается и порождается
 * заново, CI сверяет результат с зафиксированным (`check:vendor`).
 *
 * Что делается с файлами:
 *   - `.mjs` → `.js`, `.d.mts` → `.d.ts`; спецификаторы `./x.mjs` и
 *     `./x.d.mts` → `./x.js` (TS резолвит `.js` в соседний `.d.ts`);
 *   - `@unocss/<pkg>` → относительный путь на вендоренный пакет;
 *   - патчи из `PATCHES` — единственное место, где вендоренный код меняется;
 *     каждый патч обязан примениться ровно один раз, иначе скрипт падает.
 *
 * Использование: node scripts/vendor-unocss.mjs
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { collectImportSpecifiers, isRelative } from '../../../scripts/lib/importSpecifiers.mjs'

const VENDOR_VERSION = '66.7.5'
const PACKAGES = ['core', 'rule-utils', 'extractor-arbitrary-variants', 'preset-mini']

// Скрипт живёт в пакете движка, а `@unocss/*` лежат в devDependencies корня
// воркспейса: yarn 1 поднимает их в общий `node_modules`.
const pkgDir = fileURLToPath(new URL('../', import.meta.url))
const root = fileURLToPath(new URL('../../../', import.meta.url))
const target = join(pkgDir, 'src/vendor')

/**
 * Патчи: [пакет, файл, что, чем, зачем]. `magic-string` — единственная внешняя
 * зависимость среди четырёх пакетов; используется одной функцией
 * (`transformThemeFn`), которой хватает простой замены по диапазонам.
 */
const PATCHES = [
  {
    pkg: 'rule-utils',
    file: 'index.js',
    why: 'убрать зависимость от magic-string (INV-DEP-1): один overwrite по диапазонам',
    from: 'import MagicString from "magic-string";\n',
    to: `// granum: вместо magic-string — минимальная замена по диапазонам.
class MagicString {
\tconstructor(source) {
\t\tthis.source = source;
\t\tthis.edits = [];
\t}
\toverwrite(start, end, content) {
\t\tthis.edits.push([start, end, content]);
\t}
\ttoString() {
\t\tlet out = this.source;
\t\tfor (const [start, end, content] of [...this.edits].sort((a, b) => b[0] - a[0]))
\t\t\tout = out.slice(0, start) + content + out.slice(end);
\t\treturn out;
\t}
}
`,
  },
]

function resolvePackageDir(name) {
  const dir = join(root, 'node_modules/@unocss', name)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (pkg.version !== VENDOR_VERSION)
    throw new Error(`@unocss/${name}: установлена ${pkg.version}, ожидается ${VENDOR_VERSION}`)
  return { dir: join(dir, 'dist'), license: readFileSync(join(dir, 'LICENSE'), 'utf8') }
}

function rewrite(content) {
  return content
    .replace(/(["'])@unocss\/(core|rule-utils|extractor-arbitrary-variants|preset-mini)\1/g, '$1../$2/index.js$1')
    .replace(/(["']\.\/[^"']+?)\.d\.mts(["'])/g, '$1.js$2')
    .replace(/(["']\.\/[^"']+?)\.mjs(["'])/g, '$1.js$2')
}

function renameFile(name) {
  if (name.endsWith('.d.mts'))
    return `${name.slice(0, -'.d.mts'.length)}.d.ts`
  if (name.endsWith('.mjs'))
    return `${name.slice(0, -'.mjs'.length)}.js`
  return name
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })

const versions = {}
let license = ''
const written = []

for (const name of PACKAGES) {
  const { dir, license: text } = resolvePackageDir(name)
  license ||= text
  versions[`@unocss/${name}`] = VENDOR_VERSION
  const out = join(target, name)
  mkdirSync(out)
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.mjs') && !file.endsWith('.d.mts'))
      continue
    let content = rewrite(readFileSync(join(dir, file), 'utf8'))
    const renamed = renameFile(file)
    for (const patch of PATCHES) {
      if (patch.pkg !== name || patch.file !== renamed)
        continue
      const count = content.split(patch.from).length - 1
      if (count !== 1)
        throw new Error(`патч ${name}/${renamed} (${patch.why}): ожидалось 1 совпадение, найдено ${count}`)
      content = content.replace(patch.from, patch.to)
    }
    writeFileSync(join(out, renamed), content)
    written.push(`${name}/${renamed}`)
  }
}

// Ни одного голого спецификатора в JS не должно остаться: пакет без
// зависимостей. `.d.ts` не проверяются: их type-only импорты (`magic-string`,
// `unconfig`, `nanoevents`) относятся к неиспользуемым API и под `skipLibCheck`
// становятся `any`, не попадая в бандл.
const bare = []
for (const rel of written) {
  if (!rel.endsWith('.js'))
    continue
  const content = readFileSync(join(target, rel), 'utf8')
  for (const spec of collectImportSpecifiers(content)) {
    if (!isRelative(spec))
      bare.push(`${rel}: ${spec}`)
  }
}
if (bare.length > 0)
  throw new Error(`остались внешние импорты:\n  ${bare.join('\n  ')}`)

writeFileSync(join(target, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`)

const digest = createHash('sha256')
for (const rel of written)
  digest.update(rel).update(readFileSync(join(target, rel)))

writeFileSync(join(pkgDir, 'THIRD_PARTY_NOTICES.md'), `# Third-party notices

\`@feugene/granum\` bundles the following packages of [UnoCSS](https://github.com/unocss/unocss),
copied verbatim from their published builds into \`src/vendor/\` by
\`scripts/vendor-unocss.mjs\` (with the patches listed there):

${PACKAGES.map(name => `- \`@unocss/${name}\` ${VENDOR_VERSION}`).join('\n')}

Vendored files digest: \`sha256:${digest.digest('hex')}\`.

${license.trim()}
`)

console.log(`vendor-unocss: ${written.length} файлов, версия ${VENDOR_VERSION}`)
