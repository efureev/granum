# Разработка провайдеров

> 🇬🇧 English version: [`../en/authoring-providers.md`](../en/authoring-providers.md).

Провайдер — npm-пакет компонентов, который публикует `dist` в раскладке
granum и `granum.manifest.json`. Приложение читает только манифест и файлы,
на которые он ссылается; JS провайдера ради резолюции не исполняется.

## Раскладка пакета

```
src/
  components/<Name>/config.ts      дескриптор (defineGranumComponent)
  components/<Name>/index.ts       entry компонента
  components/<Name>/<Name>.vue     код и <style>
  components/<Name>/styles.css     необязательный CSS (cssFiles)
  components/<Name>/themes/        токены компонента по темам (themesDir)
  theme/{tokens,base}.css          тема-независимый фундамент
  themes/registry.json             реестр токенов владельца тем
  themes/<id>.json                 данные тем каталога
  granum-provider/index.ts         defineGranumProvider
  index.ts                         barrel
dist/
  components/<Name>/index.js       entry в раскладке
  components/<Name>/chunks/*.js    SFC-чанки компонента
  components/<Name>/styles.css     CSS компонента
  groups/<g>/shared/*.js           общие чанки группы
  chunks/*.js                      общие чанки вне групп
  granum/contract.js               встроенный контракт granum, если код его импортирует
  theme/*.css                      фундамент (копия src/theme)
  themes/*.json                    реестр и полные данные тем
  granum.manifest.json
```

Файлы темы объявляются путями относительно `dist` (`theme/base.css`,
`themes/slate.json`), а исходники лежат зеркально в `src/`: плагин копирует их сам.

## Дескриптор компонента

```ts
import { defineGranumComponent } from '@feugene/granum/contract'

export const xhButtonConfig = defineGranumComponent(import.meta.url, {
  name: 'XhButton',
  dependencies: ['XhIcon', '@acme/base:XBox'],
  safelist: ['p-2', 'p-3', 'bg-[var(--xh-btn-bg)]'],
  dynamicTokens: ['xh-z-*'],
  hookTokens: ['xh-btn-ring'],
  cssFiles: ['./styles.css'],
  themesDir: './themes',
  group: 'controls',
})
```

Хелперы `@feugene/granum/contract` сборка провайдера встраивает в `dist` отдельным
файлом `granum/contract.js`. Поэтому дескриптор можно реэкспортировать из entry
компонента: пакет не потянет granum в рантайм, и granum остаётся в
`devDependencies` провайдера. Другие точки входа granum, импортированные в
рантайме (например, реэкспорт `@feugene/granum/runtime`), — зависимость пакета:
объявите `@feugene/granum` в `peerDependencies`, иначе сборка запишет в манифест
`peer-missing`.

| Поле | Зачем |
|---|---|
| `dependencies` | компоненты, чей код этот компонент импортирует; короткая форма — тот же провайдер, `id:Name` — чужой |
| `safelist` | только классы, которые собираются в JS в рантайме; литералы шаблона сюда не пишутся — их извлечёт сборка |
| `dynamicTokens` | токены, чьё имя собирается в рантайме; обрезка их не удалит, пока компонент в сборке |
| `hookTokens` | хуки: токены, которые компонент читает только через `var(--x, запасное)`, а задать их вправе тема или приложение. Без объявления такой токен, не заданный ни одним слоем, — находка `doctor` `token-fallback-only` |
| `cssFiles` | CSS, читаемый как есть; путь относительно `config.ts`, внутри директории компонента. `styles.css` рядом с `<style>` SFC склеивается с ним в один файл: сначала объявленный |
| `themesDir` | папка токенов компонента по темам: `<тема>/root.{json,css}`, `<тема>/modes/<режим>.{json,css}`; ключи без `--` |
| `group` | общие чанки нескольких компонентов кладутся в `groups/<g>/shared/` |

Первый аргумент — `import.meta.url` модуля `config.ts`: по нему сборка
находит директорию компонента и исходники `cssFiles`.

## Провайдер

```ts
import { defineGranumProvider } from '@feugene/granum/contract'

export default defineGranumProvider({
  id: '@acme/ui',
  contractVersion: 2,
  components: [xhCardConfig, xhButtonConfig],
  theme: {
    tokensCss: 'theme/tokens.css',
    baseCss: 'theme/base.css',
    registry: 'themes/registry.json',
    defaultTheme: 'slate',
    catalog: {
      slate: { title: 'Сланец', docs: 'https://example.com/themes/slate', data: 'themes/slate.json' },
      clay: { title: 'Глина', extends: 'slate', data: 'themes/clay.json' },
    },
  },
  engine: { dialect: 'unocss/preset-wind3+granum@66', rules: [['btn-reset', { appearance: 'none' }]] },
  dependencies: ['@acme/base'],
})
```

`dependencies` провайдера — id пакетов, которые обязаны быть в графе
приложения. Их токены, base, темы и правила движка идут раньше этого
провайдера, как бы приложение ни перечислило пакеты в `providers`; цикл —
`CircularProviderDependencyError`. Строковую зависимость, которой нет в
`providers`, приложение подгружает само — пакет ищется от каталога зависящего
провайдера, поэтому достаточно перечислить его в `dependencies` своего
`package.json`. Компоненты такого донора селекция `'all'` не выбирает.

`defineGranumProvider` проверяет форму при вызове: `contractVersion`, id,
имена компонентов, пути `cssFiles`, id тем каталога, их `extends` и
`defaultTheme`. Ошибки — типизированные классы с полями `providerId`,
`component`, `reason`. Ключи тем контракта 1 (`theme.themes`, `defaultThemes`,
`tokenDefinitions`, `tokenDefinitionsRef`) — `legacy-token-definitions` с
подсказкой; `contractVersion: 1` допустим только у пакета без тем.

## Темы: каталог, реестр, данные

Тема — данные, а не CSS-файл: JSON `GranumThemeData` без селекторов. Селекторы
назначает приложение из активации режима, поэтому правила каскада одни для
темы провайдера и темы приложения.

```json
{
  "id": "slate",
  "title": "Сланец",
  "root": { "xh-radius": "6px", "xh-ring": "0 0 0 2px var(--xh-accent)" },
  "defaultMode": "light",
  "modes": {
    "light": { "colorScheme": "light", "tokens": { "xh-bg": "#ffffff", "xh-accent": "#2563eb",
               "xh-soft": "color-mix(in oklab, var(--xh-accent) 15%, var(--xh-bg))" },
               "fallbacks": [{ "supports": "not (color: color-mix(in oklab, red, red))", "tokens": { "xh-soft": "#dbeafe" } }] },
    "dark": { "colorScheme": "dark", "tokens": { "xh-bg": "#0f172a", "xh-accent": "#60a5fa" } }
  },
  "extensions": { "acme": { "componentDefaults": { "XhButton": { "size": "m" } } } }
}
```

- Id темы — slug `^[a-z][a-z0-9-]*$`, имя режима — slug без дефиса, `root`
  запрещено: иначе пара `<тема>-<режим>` не разбиралась бы по последнему дефису.
- `defaultMode` обязан быть ключом `modes`; без него обязателен режим `light`
  (`default-mode-missing`). `extends` режима — режим той же темы, цикл —
  `mode-extends-cycle`.
- Тема с `extends` в каталоге хранит в исходнике только отличия. Сборка
  сливает их с родителем: токены — по ключу, `fallbacks` режима и `baseCss`
  заменяются целиком, `extensions` сливаются на верхнем уровне; id, `title`,
  `docs` берутся из записи каталога. В `dist` уходят полные данные.
- Реестр (`registry`) — `{ "<токен>": "root" | "mode" }`. Сборка проверяет по нему
  каждую тему: токен `root` есть в `root`, токен `mode` — в итоговых токенах каждого
  режима. Нехватка — `theme-incomplete` с перечнем вида `dark:xh-bg`.
- В манифест уходит индекс каталога: `title`, `extends`, `docs`, путь к данным,
  режимы (режим по умолчанию первым) и `defaultMode` — CLI перечисляет темы, не
  читая данных. `theme.declares` включает реестр и все темы каталога.

Владелец каталога в графе приложения один, и ему не нужны компоненты: пакет
токенов дизайн-системы — провайдер только с `theme`. Пакеты компонентов зависят от
него строкой в `dependencies` и кладут токены компонентов в `themesDir`:

```
components/XhButton/themes/
  slate/modes/light.json      { "xh-button-bg": "var(--xh-accent)" }
  slate/modes/dark.json       только отличия от light — остальное возьмёт приложение
  clay/modes/light.json       чего нет — по цепочке clay → slate
  slate/root.json             режимонезависимые токены компонента
```

Имя папки — id темы, имя файла — режим; файл — JSON или CSS с одним плоским блоком
(селектор не важен). Иное содержимое — `invalid-theme-dir`; `README.md` и скрытые
файлы пропускаются. Темы чужого каталога законны: спутник кладёт токены для тем
дизайн-системы, и приложение применяет их, когда тема активна. Объектная форма
провайдера (тесты, локальная разработка) данных не сливает: её `data` обязаны быть
полными. Примеры — фикстуры [`themes-package`](../../fixtures/themes-package/README.md),
[`themed-ds-package`](../../fixtures/themed-ds-package/README.md) и
[`themed-companion-package`](../../fixtures/themed-companion-package/README.md).

Правила `engine` пишутся в типах granum (`GranumRule`, `GranumVariant`,
`GranumPreflight`) — форма та же, что у правил UnoCSS, но без импорта чужих
пакетов. Вместе с ними обязателен `dialect` — имя словаря, против которого они
написаны (`<vendor>/<vocabulary>@<major>`): без него регистрация падает с
`rules-without-dialect`, потому что пригодность правила приложению нечем
проверить. Исполнит его только движок того же диалекта.

`dialect` можно объявить и без правил — как утверждение о словаре классов
пакета: сборка сверит утверждение с диалектом своего движка и не даст записать
в манифест чужой (`EngineDialectMismatchError`). Пакет, не пользующийся
утилитами вовсе, блок `engine` не объявляет — в его манифесте диалект и
отпечаток равны `null`, и он читается любым движком без пересчёта. Что из этого
следует приложению — в [движках и диалектах](./engines-and-dialects.md).

## Тема без granum

Приложение без granum берёт тему готовым листом —
`@scope/ds/themes/<id>.css`. Соберите его `emitThemeStylesheet` из
`@feugene/granum/node`: слои `tokens`, `base` и `themes` по тем же правилам, что у
сборки приложения, с токенами тем всех ваших компонентов. Передайте сам объект
провайдера — компоненты не сканируются, папки `themesDir` читаются рядом с
`config.ts`:

```js
import { emitThemeStylesheet } from '@feugene/granum/node'
import { provider } from './src/granum-provider/index.ts'

const { css } = await emitThemeStylesheet({ providers: [provider], theme: 'slate', root: process.cwd() })
```

Тот же лист по частям — `parts`: `root` (всё, что от режима не зависит) и
`modes.<режим>` (пара режима с фолбэками). Разложите их файлами —
`themes/<id>/root.css`, `themes/<id>/<режим>.css`, — и приложение возьмёт `root` и
только свои режимы; его бандлер склеит их в один файл. `root` подключается
первым. Каждый режим самодостаточен — наследование по `extends` в нём уже
раскрыто, — а `:root` несёт только режим по умолчанию: приложению без него пару
на `<html>` ставит скрипт режима или разметка.

Токенов пакетов-спутников в таком файле нет: все манифесты знает только сборка
приложения. Ключ с `$` в JSON папки `themesDir` — пояснение для читателя
(`"$comment"`), а не токен.

Контроллеру режимов в таком приложении нужен манифест, а `virtual:granum/themes`
нет. `createThemeManifest` из `@feugene/granum/runtime` собирает его по описанию
темы — каталогу вашего пакета — тем же правилом пары, что сборка:

```js
import { createThemeManifest } from '@feugene/granum/runtime'

const manifest = createThemeManifest({
  theme: { id: 'slate', title: 'Сланец' },
  modes: [{ name: 'light', colorScheme: 'light' }, { name: 'dark', colorScheme: 'dark' }],
  defaultMode: 'light',
})
```

## Сборка

```ts
import { granumProvider } from '@feugene/granum/build'
import { windEngine } from '@feugene/granum-engine-wind'

granumProvider({
  provider,
  engine: windEngine(),
  engineModule: 'granum-provider/engine.js',
  sourceDir: 'src',
  indexEntry: 'src/index.ts',
  dependencyCheck: 'error',
  boundaryCheck: 'error',
  exportsCheck: 'error',
})
```

`engine` обязателен: именно он фильтрует классы манифеста, и его диалект с
отпечатком словаря уезжают в блок `engine` — список классов есть факт о
конкретной реализации. Правила в JSON не встраиваются, поэтому `engineModule`
указывает путь относительно `dist` до ESM-модуля с
`export default { rules, variants, preflights }`; объявленные правила без пути
дают предупреждение `engine-module-missing`.

Плагин:

1. строит `build.lib.entry` из реестра компонентов и раздаёт чанкам имена по
   раскладке;
2. извлекает статические классы из чанков каждого компонента экстрактором
   движка и оставляет только те, для которых есть правило;
3. собирает потребляемые токены: `var(--x)` в CSS, `var(--x)` и литералы
   `'--x'` в JS, `dynamicTokens`; материализует папку `themesDir` каждого
   компонента в манифест;
4. читает реестр и данные тем каталога, дополняет тему с `extends` данными
   родителя, проверяет полноту по реестру и пишет полные данные в `dist`;
5. раскрывает `@apply` в CSS компонентов: класс подставляется декларациями
   своего единственного плоского правила. Вариант (`hover:`, `md:`,
   `print:`), класс из нескольких правил (`container`) и директива вне
   плоского правила — `ApplyExpansionError`; в `dist` директив не остаётся;
6. строит фактический граф «компонент → компонент» по импортам бандла и
   сверяет с `dependencies`: неучтённое ребро — `UndeclaredDependencyError`;
7. проверяет, что браузерный код не импортирует `node:*` и node-entry granum
   (`BoundaryViolationError`), а `package.json#exports` содержит манифест и
   subpath каждого компонента (`PackageExportsError`);
8. пишет `dist/granum.manifest.json`.

Импорт константы или типа из директории другого компонента зависимостью не
является и объявлять его не нужно: рёбра считаются по коду, попавшему в
чанки чужого компонента.

## Провайдер только с правилами

Свои правила утилит приложение может передать фабрике движка
(`windEngine({ rules })`), но тогда отпечаток словаря его движка расходится с
отпечатками пакетов, и granum на каждой сборке пересчитывает их классы из
файлов. Если цена важна, правила выносят в пакет-провайдер без компонентов:
движок приложения остаётся ванильным, и сборка идёт быстрым путём.

```ts
// src/engine.ts — модуль правил, уезжает в dist/engine.js
import type { GranumRule } from '@feugene/granum/engine'

export const brandRules: readonly GranumRule[] = [
  ['brand-logo', { 'background-color': '#7c3aed' }],
  [/^brand-pad-(\d+)$/, ([, step]) => ({ padding: `${Number(step) * 4}px` })],
]

export default { rules: brandRules }
```

```ts
// vite.config.ts
granumProvider({
  provider: defineGranumProvider({
    id: '@acme/brand-rules',
    contractVersion: 2,
    components: [],
    engine: { dialect: WIND_DIALECT_EXTRA, rules: brandRules },
  }),
  engine: windEngine(),
  indexEntry: false,
  entries: { engine: 'src/engine.ts' },
  engineModule: 'engine.js',
})
```

- Пакет собирают **ванильным** движком своего диалекта, без правил пакета:
  отпечаток в манифесте тогда равен отпечатку ванильного движка приложения, и
  приложение принимает манифест как есть.
- Диалект пакета обязан совпасть с диалектом движка приложения: иначе модуль
  правил не загружается (`engine-rules-skipped` в `doctor`), и классы правил не
  генерируются.
- Модуль исполняется в Node на сборке приложения и отдаёт
  `export default { rules, variants, preflights }`. Данные правил встраивайте при
  сборке пакета: JSON внутри пакета бандлер встраивает сам. Импорт JSON из другого
  пакета, оставленный внешним, сборка выпускает без атрибута
  `with { type: 'json' }`, и приложение падает при загрузке модуля с
  `ERR_IMPORT_ATTRIBUTE_MISSING`.
- В `exports` достаточно `./granum.manifest.json`: модуль правил приложение
  находит по пути из манифеста.

Рабочий пример — фикстура [`rules-only-package`](../../fixtures/rules-only-package)
и стенд [`app-rules`](../../apps/app-rules).

## Codegen

Реестр провайдера, barrel и `exports` генерируются из директорий
компонентов. Стандартный набор целей доступен из CLI —
`granum codegen` и `granum codegen --check` для CI (см. [CLI](./cli.md));
свои цели — программно:

```js
// scripts/generate-registry.mjs
import { fileURLToPath } from 'node:url'
import { codegenTargets, runRegistryCodegen } from '@feugene/granum/codegen'

await runRegistryCodegen({
  packageDir: fileURLToPath(new URL('..', import.meta.url)),
  check: process.argv.includes('--check'),
  targets: [
    codegenTargets.barrel(),
    codegenTargets.packageExports(),
    codegenTargets.manifestExport(),
    ...codegenTargets.providerRegistry(),
  ],
})
```

## Чек-лист перед релизом

- `vite build` проходит без предупреждений `safelist-redundant` и
  `css-double-delivery`, либо они объяснены. Самый частый источник второго —
  плагин, вшивающий CSS компонента в его JS-чанк (`vite-plugin-lib-inject-css`
  и подобные): до granum это был единственный канал доставки, а с ним тот же
  файл приезжает из манифеста, и потребитель получает два экземпляра. Второй
  при этом **вне слоёв `granum.*`** и потому сильнее всей библиотеки. Такой
  плагин из конфига провайдера убирают;
- `granum.manifest.json` в `exports`; `sideEffects: false`; `files` пакета покрывает
  весь `dist`, включая `granum/contract.js`;
- пакет с правилами объявляет `engine.dialect` и собран движком того же
  диалекта, а `engineModule` указывает на собранный модуль правил;
- `dependencies` компонентов покрывают импорты — сборка иначе не пройдёт;
- темы каталога полны по реестру, а папки `themesDir` названы id тем и режимов —
  иначе сборка не пройдёт;
- кросс-провайдерный донор перечислен в `peerDependencies`; granum — тоже, если
  `dist` импортирует его точку входа кроме встроенного `./contract`;
- `doctor --strict` приложения-потребителя выходит с кодом `0`.
