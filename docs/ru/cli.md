# CLI `granum`

> 🇬🇧 English version: [`../en/cli.md`](../en/cli.md).

Все команды работают **без сборки приложения** — по манифестам провайдеров и
`granum.config.*`; исключение — `report`, читающий `granum-report.json`
собранного приложения. Первый аргумент — путь к конфигу; корень приложения —
его директория.

```bash
granum doctor  granum.config.ts [--json] [--strict]
granum explain granum.config.ts <providerId:Component> [--json]
granum why-css granum.config.ts <class> [--json]
granum tokens  granum.config.ts <providerId:Component> [--deep] [--json]
granum prune   granum.config.ts [--json] [--strict]
granum report  [dist/granum-report.json] [--json] [--strict]
```

Конфиг `.ts` загружается через `vite` приложения (`loadConfigFromFile`), а
если `vite` из корня не резолвится — нативным `import()`. Принимаются
экспорты `default`, `granum` и `config`.

## Коды выхода

| Код | Когда |
|---|---|
| `0` | чисто |
| `1` | найдены ошибки; с `--strict` — и предупреждения; ошибка выполнения |
| `2` | неверный вызов: нет команды, конфига или предмета |

`doctor` возвращает `1` при любом `error` независимо от `--strict`;
`explain`, `tokens` и `why-css` — `1`, если предмет не найден; `prune` — `1`
только с `--strict` и при наличии удаляемых токенов; `report` — `1` с
`--strict`, если есть классы без правила или токены без объявления.

## `doctor`

Полный отчёт о конфигурации: провайдеры и их форма, селекция в порядке
зависимостей, темы и источник набора, блоки токенов, проверенные файлы и
диагностика. Уровни: `error` — сборка обязана сломаться, `warn` — законно, но
подозрительно.

| Код | Уровень | Что значит |
|---|---|---|
| `missing-file` | error | файл манифеста отсутствует на диске |
| `apply-not-expanded` | error | в CSS провайдера остался `@apply` — пересоберите провайдер плагином |
| `boundary` | error | чанк провайдера импортирует `node:*` или node-entry granum |
| `important-in-provider-css` | warn | `!important` внутри слоя инвертирует порядок каскада |
| `safelist-redundant` | warn | safelist дублирует статически извлечённые классы |
| `css-double-delivery` | warn | CSS компонента и инлайнится, и импортируется его чанком |
| `safelist-dead` | warn | запись safelist без правила у движка |
| `token-undefined` | warn | токен потребляется, но не объявлен ни одним слоем |
| `token-conflict` | warn | токен пишут несколько слоёв; показана цепочка и итог |
| `theme-warning` | warn | предупреждения резолюции тем (`extends`, неполные темы) |
| `override-skipped` | warn | `strictTokens` отбросил override |
| `provider-without-manifest` | warn | провайдер передан объектом: классы и потребление неизвестны |
| `unused-provider` | warn | провайдер ничего не приносит в сборку |

```
granum doctor
=============

Providers (1):
  • @granum-fixtures/heavy [manifest 0.1.0] — components: 7, theme: yes

Selected components (5, order = deps → dependents):
  • @granum-fixtures/heavy:XhAlert — classes: 9, css: 1
  …

Diagnostics (errors: 0, warnings: 1):
  ⚠ [safelist-dead] @granum-fixtures/heavy:XhButton — safelist entry 'shadow-legacy' has no rule in the engine

✓ OK — no errors; warnings: 1 (they only fail with --strict).
```

## `explain`

Почему компонент в сборке (`selected`, `dependency`, `not-selected`,
`unknown`), кратчайшая цепочка от корня селекции, кто его требует, и что он
приносит: классы, safelist, CSS, файлы, потребляемые и объявляемые токены.

## `why-css`

Каким каналом класс попал в CSS — статика манифеста, safelist, селектор в
CSS компонента, исходники приложения — и каким правилом движка сгенерирован
(источник, слой, селектор). `Rule: none` означает класс-крючок или опечатку.

## `tokens`

Что компонент объявляет и потребляет; для каждого токена — откуда значение
(`own`, `component`, `provider`, `app`, `none`) и цепочка слоёв по темам.
`--deep` включает зависимости компонента.

## `prune`

Что удалит обрезка и что сохранит с причиной — по тому же плану, которым
пользуется сборка; эмиссию команда не меняет. Байты «до → после» по файлам.

## `report`

Читает `granum-report.json`: селекция, темы, классы без правила с
источниками, safelist, покрытый статикой, план обрезки, размеры слоёв
raw/gzip/brotli, предупреждения.

## Программный доступ

Все функции и форматтеры экспортируются из `@feugene/granum/node`:

```ts
import { formatDoctorReport, granumDoctor, loadGranumConfigFile, prepareApp } from '@feugene/granum/node'

const { config, root } = await loadGranumConfigFile('granum.config.ts', process.cwd())
const app = await prepareApp(config, root)
const report = await granumDoctor(app)
console.log(formatDoctorReport(report))
```

В CI: `granum doctor granum.config.ts --strict` до сборки и
`granum report --strict` после.
