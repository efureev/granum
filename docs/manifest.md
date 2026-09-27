# Формат `granum.manifest.json`

Версия формата: **1**. Нормативно для требований `M-*` из [`spec.md`](./spec.md) §7.

Манифест — машинно-порождённое описание провайдера. Его пишет только плагин
`granumProvider()` (`./build`), читает — плагин приложения (`./vite`), `./node` и CLI.
Он публикуется в корне `dist` и экспортируется как `"./granum.manifest.json"`.

## 1. Расположение и разрешение путей

- Файл лежит в директории, которая является корнем раскладки (`<base>`); все пути в
  манифесте — относительно этой директории, POSIX-разделители, без ведущего `./`,
  без `..`, без абсолютных путей (INV-MAN-2).
- Приложение находит манифест так: `import.meta.resolve('<id>/granum.manifest.json')`.
  Поле `exports` пакета обязано содержать этот subpath (INV-LAY-2).
- Объектная форма провайдера (`GranumProvider` в конфиге) манифеста не имеет; для неё
  база — `baseUrl` объекта, а поля `classes` и `tokens.consumes` заполняются медленным
  путём (`R-6`).

## 2. Пример

```json
{
  "granum": 2,
  "contractVersion": 1,
  "id": "@feugene/heavy-package",
  "version": "0.1.0",
  "generatedBy": "@feugene/granum@0.1.0",
  "hash": "sha256-3f2a…",
  "dependencies": ["@feugene/simple-package"],
  "theme": {
    "tokensCss": "theme/tokens.css",
    "baseCss": "theme/base.css",
    "themes": { "dark": "theme/dark.css", "light": "theme/light.css" },
    "defaultThemes": ["light"],
    "tokenDefinitions": {
      "dark": { "selector": ".dark, [data-theme=\"dark\"]", "tokens": { "xh-bg": "#111" } }
    },
    "declares": ["--xh-accent", "--xh-bg", "--xh-space-2"]
  },
  "engine": {
    "dialect": "unocss/preset-wind3+granum@66",
    "vocabulary": "fnv64-2f8975047b2c4cc5",
    "name": "granum-engine-wind",
    "version": "66.7.5",
    "module": "granum-provider/engine.js"
  },
  "components": {
    "XhPanel": {
      "entry": "components/XhPanel/index.js",
      "files": [
        "components/XhPanel/chunks/XhPanel-Bq1c.js",
        "components/XhPanel/index.js"
      ],
      "css": ["components/XhPanel/styles.css"],
      "group": null,
      "dependencies": ["XhCard", "@feugene/simple-package:XTest1"],
      "classes": ["flex", "gap-[var(--xh-space-2)]"],
      "safelist": [],
      "tokens": {
        "declares": {},
        "consumes": ["--xh-panel-bg", "--xh-space-2"],
        "requires": ["--xh-space-2"],
        "dynamic": ["--xh-z-*"]
      },
      "hash": "sha256-9c0e…"
    }
  },
  "warnings": [
    { "code": "safelist-redundant", "component": "XhButton", "classes": ["border"] }
  ]
}
```

## 3. Поля

### 3.1 Корень

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `granum` | `2` | да | версия формата манифеста; читатель отклоняет любую другую, включая `1` (`UnsupportedManifestVersionError`) |
| `contractVersion` | `1` | да | версия контракта провайдера |
| `id` | `string` | да | id провайдера, совпадает с `name` пакета |
| `version` | `string` | да | версия пакета из `package.json` |
| `generatedBy` | `string` | да | `@feugene/granum@<версия>`, для диагностики несовместимостей |
| `hash` | `string` | да | `sha256` от канонической сериализации манифеста без поля `hash`; читатель пересчитывает и при несовпадении бросает `InvalidManifestError` (`hash-mismatch`) — так ловится ручная правка (INV-MAN-1) |
| `dependencies` | `string[]` | да | id провайдеров-доноров (обе формы v1 сводятся к id; инстансы доноров приложение подключает сам через свои манифесты) |
| `theme` | объект | да | см. 3.2; может быть `{}` |
| `engine` | объект | да | движок, которым порождён артефакт (3.4); приложение не догадывается о нём по косвенным признакам (INV-MAN-9) |
| `components` | объект | да | имя → описание компонента (3.3); ключи отсортированы |
| `warnings` | массив | да | предупреждения сборки провайдера, которые приложение обязано показать в отчёте (3.5) |

### 3.2 `theme`

| Поле | Тип | Описание |
|---|---|---|
| `tokensCss` | `string?` | путь к CSS с тема-независимыми токенами |
| `baseCss` | `string?` | путь к базовым стилям |
| `themes` | `Record<string, string>` | имя темы → путь к CSS-файлу темы |
| `defaultThemes` | `string[]` | темы, активируемые по умолчанию |
| `tokenDefinitions` | `Record<theme, TokenSet>` | структурные токены провайдера; сюда же материализованы `tokenDefinitionsRef` |
| `declares` | `string[]` | все токены (с `--`), объявленные `tokensCss`, `baseCss`, файлами тем и `tokenDefinitions`; отсортированы |

`TokenSet = { selector?: string, tokens: Record<string, string> }`; ключи `tokens` —
без `--` (C-12).

### 3.3 `components[Name]`

| Поле | Тип | Описание |
|---|---|---|
| `entry` | `string` | путь к `index.js`; обязан быть `components/<Name>/index.js` (INV-LAY-1) |
| `files` | `string[]` | все файлы, вошедшие в чанки компонента, включая общие чанки группы; отсортированы; используются для хеша и для `doctor` |
| `css` | `string[]` | CSS компонента в порядке эмиссии: сначала `cssFiles` дескриптора, затем эмитированный `styles.css` |
| `group` | `string \| null` | группа для общих чанков |
| `dependencies` | `string[]` | нормализованные ключи: `Name` для того же провайдера, `providerId:Name` для чужого; отсортированы |
| `classes` | `string[]` | статические классы, извлечённые из `files` и CSS-независимых шаблонов; отсортированы; без пересечения с `safelist` в норме |
| `safelist` | `string[]` | из дескриптора, отсортированы |
| `tokens.declares` | `Record<theme, TokenSet>` | токены компонента (`tokenDefinitions` + материализованные ref) |
| `tokens.consumes` | `string[]` | токены, найденные в CSS компонента и в JS `files` (`var(--x)` и литералы `'--x'`), с `--` |
| `tokens.requires` | `string[]?` | подмножество `consumes`, значение которого обязан дать кто-то извне: потребление хотя бы раз без fallback, и сам компонент его не присваивает. Именно это множество проверяет `token-undefined` (T-5). Поля может не быть — манифест формата 2 читается как прежде, и диагностика смотрит весь `consumes` |
| `tokens.dynamic` | `string[]` | из `dynamicTokens` дескриптора; допускается суффикс `*` |
| `hash` | `string` | `sha256` от содержимого `files` и `css`; ключ кэша приложения (A-17) |

### 3.4 `engine`

Список классов каждого компонента — не свойство пакета, а результат фильтрации
его кандидатов конкретной реализацией движка (B-6). Поэтому манифест обязан
сказать, кто фильтровал: без этой записи приложение не может ни доверять списку,
ни объяснить, почему класса нет.

| Поле | Тип | Описание |
|---|---|---|
| `dialect` | `string \| null` | имя словаря классов, `<vendor>/<vocabulary>@<major>`; `null` — артефакт ни от какого словаря не зависит и ни одного не расширяет |
| `vocabulary` | `string \| null` | отпечаток фактического множества генерируемых имён; `null` тогда и только тогда, когда `dialect` равен `null` |
| `name` | `string` | реализация, собравшая пакет — для диагностики |
| `version` | `string?` | версия реализации; **в решениях не участвует**, только для чтения человеком |
| `module` | `string \| null` | относительный путь к ESM-модулю с `export default { rules, variants, preflights }` в типах granum; `null`, если правил нет |

Диалектом приложение управляет одним решением — грузить ли `module`: правило
написано против словаря и переживает смену реализации внутри мажора. Отпечатком —
другим: верить ли списку классов. При различии отпечатков приложение пересчитывает
классы пакета своим движком из `files` и называет разницу; при различии диалектов
ещё и не грузит правила. Полная таблица решений — в ТЗ §9.4.

`dialect: null` при непустых `classes`/`safelist` или непустом `module` — ошибка
чтения `dialect-without-classes`: список классов кто-то всё-таки отфильтровал.
Несогласованность `dialect` и `vocabulary` по `null` — `dialect-vocabulary-mismatch`.

### 3.5 `warnings[]`

`{ code: string, component?: string, ...details }`. Коды, которые пишет сборка
провайдера: `safelist-redundant` (`classes`), `css-double-delivery` (`files`),
`peer-missing` (`provider` — донор, которого нет в `peerDependencies` пакета, C-5),
`engine-module-missing` (провайдер объявил правила движка, но не передал
`granumProvider({ engineModule })`, и манифест уехал бы с `engine.module: null`,
M-7).

Предупреждения резолюции приложения (`default-theme-without-source`,
`provider-scanned`, `override-skipped`) и диагностики `doctor` (`token-undefined`,
`apply-not-expanded`, `safelist-dead`) в манифест НЕ попадают: провайдер о селекции
и темах приложения ничего не знает. Их список — в ТЗ §14.

## 4. Правила валидации (читатель)

Читатель (`./node`, `readManifest`) обязан проверять в этом порядке, останавливаясь на
первой ошибке:

1. JSON парсится; корень — объект.
2. `granum === 2`; иначе `UnsupportedManifestVersionError`.
3. Схема: обязательные поля присутствуют, типы верны; иначе `InvalidManifestError`
   (`schema`, с путём до поля).
4. Все пути относительные, без `..`, без `\`; иначе `InvalidManifestError`
   (`path-escapes-package`).
5. Блок `engine` согласован: `dialect` и `vocabulary` равны `null` одновременно
   (`dialect-vocabulary-mismatch`), и при `dialect: null` у компонентов нет ни
   классов, ни safelist, а `module` пуст (`dialect-without-classes`). Проверка
   идёт ДО хеша намеренно: расхождение словаря конкретнее, чем «файл правили
   руками», и разработчику полезнее увидеть его.
6. `hash` совпадает с пересчитанным; иначе `InvalidManifestError` (`hash-mismatch`).
7. `components[Name].entry === 'components/<Name>/index.js'`; иначе `InvalidManifestError`
   (`entry-layout`).
8. Ключи `tokens` в `TokenSet` без `--`; иначе `InvalidManifestError` (`token-key-prefix`).
9. Существование файлов **не** проверяется при чтении (это делает `doctor` и чтение CSS
   в момент эмиссии, с `CssReadError`).

## 5. Каноническая сериализация

- `JSON.stringify` с отступом 2 пробела, `\n` в конце файла.
- Ключи всех объектов — в порядке `localeCompare('en')`, кроме корня, где порядок
  фиксирован как в примере (для читаемости диффов).
- Массивы строк отсортированы тем же компаратором. Исключения с семантичным порядком:
  `css` (порядок эмиссии), `defaultThemes` (порядок активации тем), `warnings`
  (сборка провайдера упорядочивает их по `code` и компоненту — порядок
  обнаружения зависел бы от обхода бандла и ломал бы побайтное равенство).
- `hash` считается от сериализации, в которой поле `hash` заменено пустой строкой.

Два запуска сборки без изменений входа обязаны дать побайтно одинаковый файл
(INV-DET-1).

## 6. Эволюция формата

- Добавление необязательного поля — совместимое изменение, версия формата не меняется.
- Удаление, переименование, изменение смысла — несовместимое: версия формата
  растёт, и читатель отклоняет прежнюю громко.
- Версия `2` (`0.2.0`): корневое `engineModule` заменено блоком `engine`. Прежняя
  версия не поддерживается — `0.1.0` публиковался как проверка и потребителей не
  имел, а тихое чтение устаревшего формата стоило бы дороже, чем пересборка
  пакета.
