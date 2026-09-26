# `@feugene/granum` — спецификация

Нормативная часть [технического задания](../../docs/spec.md) пакета:
контракт провайдера, сборка провайдера, манифест, резолвер и ошибки.
Слова **MUST / MUST NOT / SHOULD / MAY** — по RFC 2119. Полная версия с
целями, архитектурой, планом и критериями приёмки — в `docs/` репозитория;
инварианты — в [`invariants.md`](../../docs/invariants.md), формат манифеста —
в [`manifest.md`](../../docs/manifest.md).

## 5. Контракт провайдера (`./contract`)

Контракт granum версии **1**. Он наследует SPEC v1 §3–§6 с изменениями §15.2.

### 5.1 `GranumProvider`

```ts
interface GranumProvider {
  id: string                                   // npm-имя пакета
  contractVersion: 1
  components: readonly GranumComponentDescriptor[]
  theme?: GranumThemeContribution
  engine?: GranumEngineContribution            // правила/варианты для движка (бывш. `unocss`)
  dependencies?: readonly (GranumProvider | string)[]
  baseUrl?: string                             // только для объектной формы (тесты, локальная разработка); у манифеста база — его директория
}
```

| ID | Требование |
|---|---|
| C-1 | `id` MUST быть непустой строкой без пробелов, уникальной в графе приложения; MAY содержать `:` (разделитель ключа — последнее двоеточие, INV-SEL-1). |
| C-2 | `contractVersion` MUST быть равен `1`; несовпадение, включая большее значение, — `UnsupportedContractVersionError` при регистрации. |
| C-3 | Имена компонентов внутри провайдера MUST быть уникальны и являться валидными сегментами пути: `/^[A-Za-z][\w-]*$/` (INV-CON-2, `InvalidComponentNameError`). |
| C-4 | `dependencies`: объект-инстанс тянет донора в граф; строка — мягкое требование присутствия по `id` (SPEC v1 §3.2). Объявление зависимости MUST NOT выбирать компоненты донора. |
| C-5 | Провайдер, ссылающийся на компоненты другого провайдера, MUST перечислить донора в `peerDependencies`. |
| C-6 | `baseUrl`, если задан, MUST быть абсолютным URL с завершающим `/`. Провайдер MUST NOT вычислять его литералом `new URL('..', import.meta.url)` (бандлер подменяет на `data:`), а MUST использовать `resolvePackageBaseUrl`. Для манифестной формы поле не используется. |
| C-7 | Поле `engine` MUST быть выражено в типах granum (`GranumRule`, `GranumVariant`, `GranumPreflight`), без импорта чужих пакетов. |

### 5.2 `GranumComponentDescriptor`

```ts
interface GranumComponentDescriptor {
  name: string
  dependencies?: readonly GranumComponentDependency[]   // 'Name' | 'providerId:Name' | { provider, components }
  safelist?: readonly string[]
  cssFiles?: readonly string[]                          // после define*: `components/<Name>/<file>`, относительно корня раскладки
  tokenDefinitions?: Readonly<Record<string, GranumTokenSet>>
  tokenDefinitionsRef?: Readonly<Record<string, GranumTokenRef>>   // после define*: объект с абсолютным `url`
  dynamicTokens?: readonly string[]                     // токены, имена которых собираются в рантайме
  group?: string
  sourceUrl?: string                                    // `import.meta.url` модуля config.ts; нужен только сборке провайдера
}
```

| ID | Требование |
|---|---|
| C-8 | `safelist` MUST содержать только собственные классы компонента, недоступные статическому извлечению. Классы, написанные в шаблоне литерально, MUST NOT дублироваться в safelist; пересечение с извлечёнными классами — предупреждение сборки провайдера `safelist-redundant` (INV-MAN-4). |
| C-9 | `dependencies` MUST покрывать фактические импорты: если код компонента импортирует файл из директории другого компонента (напрямую или через общий чанк), тот MUST быть достижим из `dependencies`. Проверяется сборкой провайдера по графу модулей (не по тексту бандла, как в v1), нарушение — ошибка `undeclared-dependency` (INV-CON-5). |
| C-10 | Импорт константы, типа или хелпера из директории другого компонента зависимостью не является; объявлять его SHOULD NOT (тянет чужой CSS и safelist). |
| C-11 | Во вводе `defineGranumComponent` `cssFiles` — пути относительно `config.ts`; хелпер нормализует их к `components/<Name>/<file>` относительно корня раскладки и сохраняет `sourceUrl`, по которому сборка провайдера находит исходник. Путь, выходящий за директорию компонента, отклоняется (`css-file-escapes-component`). Механизма `cssFileAssetNames` нет: в манифесте лежит один путь относительно манифеста (§15.2). |
| C-12 | Ключи токенов в `tokenDefinitions` MUST NOT начинаться с `--`; префикс добавляет генератор. Ключ с `--` — ошибка регистрации `InvalidTokenKeyError` (в v1 было молчаливое `----x`). |
| C-13 | `tokenDefinitionsRef` — ссылка на CSS, из которого токены читаются при сборке провайдера (а не приложения, как в v1) и материализуются в манифест. `strict` по умолчанию `true`. |
| C-14 | `dynamicTokens` — имена (или префиксы с `*`) токенов, которые компонент читает в рантайме; они MUST попадать в манифест как потребляемые и MUST NOT удаляться обрезкой. |
| C-15 | `group` включает сканирование `groups/<g>/shared/` при извлечении классов и учёт общих чанков в графе зависимостей. |

### 5.3 Темы и токены

Наследуются SPEC v1 §6 целиком: именование без `--` (C-12), порядок определения
активного набора тем (INV-THM-1), приоритет слоёв токенов (INV-THM-2), поведение
`strictTokens` (INV-THM-3), правило «структурное определение побеждает файл темы».

| ID | Требование |
|---|---|
| C-16 | `theme.tokensCss`, `theme.baseCss`, `theme.themes[name]` — относительные пути; в манифест попадают относительно манифеста. |
| C-17 | Тема, объявленная в `defaultThemes`, SHOULD иметь источник (`themes[name]` или `tokenDefinitions[name]`); иначе предупреждение `default-theme-without-source`. |

### 5.4 Хелперы

| ID | Требование |
|---|---|
| C-18 | `defineGranumComponent(import.meta.url, options)` MUST нормализовать `cssFiles`, `tokenDefinitionsRef` и вернуть дескриптор, удовлетворяющий §5.2. Рукописный дескриптор MUST воспроизвести те же инварианты сам. |
| C-19 | `defineGranumProvider(provider)` MUST выполнять проверки C-1…C-7 и C-12 при вызове (fail-fast при регистрации, INV-ERR-1). |
| C-20 | Хелперы MUST быть чистыми и не трогать файловую систему. |

---

## 6. Сборка провайдера (`./build`)

Плагин `granumProvider(options)` для `vite.config.ts` провайдера. Заменяет
`granularChunkFileNames`, `granularAssetFileNames`, `granularCssAssetsPlugin` и ручной
список entry из v1.

### 6.1 Раскладка

| ID | Требование |
|---|---|
| B-1 | Для каждого компонента в `dist` MUST существовать `components/<Name>/index.js`; SFC-чанки компонента MUST лежать под этой директорией (INV-LAY-1). |
| B-2 | Чанки, общие для нескольких компонентов одной группы, MUST лежать в `groups/<g>/shared/`; чанки, общие для компонентов без группы или разных групп, MUST лежать в `chunks/` и MUST быть учтены в графе зависимостей как ребро между компонентами (B-8). |
| B-3 | CSS компонента (из `<style>` SFC или `cssFiles`) MUST эмитироваться в `components/<Name>/styles.css` либо по путям, объявленным в `cssFiles`; двойной доставки (импорт из чанка + инлайн через манифест) MUST NOT быть (INV-CSS-5). |
| B-4 | Плагин MUST сам построить `build.lib.entry` из реестра компонентов провайдера; ручной список entry допускается как override. |
| B-5 | В выводе MUST NOT быть `data:`-URL на месте путей пакета (проверка на бандле, INV-LAY-3). |

### 6.2 Извлечение

| ID | Требование |
|---|---|
| B-6 | Для каждого компонента плагин MUST извлечь статические классы из его файлов в `dist` (собственные чанки, общие чанки группы и `chunks/*`, до которых он дотягивается) экстрактором движка и оставить только токены, для которых у движка (встроенного плюс правил провайдера) есть правило. Результат — отсортированный список без дубликатов. Токены кода без правила классами не являются. |
| B-7 | Извлечение MUST выполняться по графу собранного бандла: файлы компонента — чанки, достижимые из его entry, кроме чанков чужих компонентов (любой файл директории другого компонента — ребро графа, а не файл этого). Файлы, не вошедшие в бандл, MUST NOT давать классов. |
| B-8 | Плагин MUST вычислить фактический граф «компонент → компонент» по импортам в бандле (чанки чужих компонентов и внешние спецификаторы `<pkg>/components/<Name>`) и сравнить с транзитивным замыканием объявленных `dependencies`; неучтённое ребро — ошибка сборки `UndeclaredDependencyError` (опция `dependencyCheck: 'warn'` понижает до предупреждения). |
| B-9 | Плагин MUST собрать потребляемые токены: `var(--x)` в CSS компонента, `var(--x)` и строковые литералы `'--x'` в JS модулей компонента, `dynamicTokens` дескриптора. |
| B-10 | Плагин MUST собрать объявленные токены: из `tokenDefinitions`, материализованных `tokenDefinitionsRef`, `theme.tokensCss`, `theme.baseCss` и файлов тем (полный скан, включая блоки внутри at-rules). Файлы темы провайдер объявляет путями относительно корня раскладки (`theme/base.css`), а исходники лежат зеркально в каталоге `sourceDir` (по умолчанию `src`): плагин копирует их в `dist`. |
| B-11 | `@apply` в CSS компонентов (объявленные `cssFiles` и стили SFC) MUST раскрываться на сборке провайдера движком (ADR-3) только внутри плоских правил; директива в комментарии не считается; вложенный контекст, вариант или класс без правила — `ApplyExpansionError`. В `dist` директивы MUST NOT оставаться. |

### 6.3 Манифест и реестры

| ID | Требование |
|---|---|
| B-12 | Плагин MUST записать `dist/granum.manifest.json` по [`manifest.md`](../../docs/manifest.md) в хуке завершения сборки, после того как известны все чанки и ассеты. |
| B-13 | Плагин MUST убедиться, что `package.json#exports` содержит `"./granum.manifest.json"` и subpath каждого компонента; отсутствие — ошибка сборки с подсказкой запустить codegen. |
| B-14 | `./codegen` MUST генерировать: barrel, реестр провайдера (импорты конфигов и записи), `exports` компонентов и экспорт манифеста (`manifestExport`). Entry-карты нет: entry строит плагин (B-4). Поведение и ошибки — как в v1 (`GranumCodegenError`, маркерные блоки). |
| B-15 | Режим `vite build --watch` MUST перезаписывать манифест на каждую пересборку (нужно для монорепо, где приложение читает манифест соседнего пакета). |

### 6.4 Проверки на бандле

| ID | Требование |
|---|---|
| B-16 | Плагин MUST проверить, что ни один модуль сборки не импортирует `@feugene/granum/{build,vite,node,codegen}`, `node:*` или встроенные модули Node (INV-BND-1), а браузерные чанки не содержат `data:text/css` (INV-LAY-3). Проверка идёт по исходному коду модулей в `transform` (Vite подменяет `node:*` заглушкой ещё на резолве, и в выводе импорта нет) и по выводу. Нарушение — `BoundaryViolationError`; опция `boundaryCheck: 'warn'` понижает до предупреждения. |
| B-17 | Плагин SHOULD печатать сводку: компоненты, число классов, safelist, потреблённые токены, предупреждения. |

---

## 7. Манифест (`granum.manifest.json`)

Полная спецификация — [`manifest.md`](../../docs/manifest.md). Здесь — требования верхнего уровня.

| ID | Требование |
|---|---|
| M-1 | Манифест MUST порождаться только сборкой; ручное редактирование запрещено и обнаруживается по хешу содержимого (INV-MAN-1). |
| M-2 | Все пути в манифесте MUST быть относительными к директории манифеста и MUST NOT содержать `..` или абсолютных путей (INV-MAN-2). |
| M-3 | Манифест MUST быть детерминированным: ключи объектов и все массивы отсортированы, пробелы нормализованы (INV-DET-1). |
| M-4 | Манифест MUST содержать версию формата (`granum`) и версию контракта (`contractVersion`); читатель MUST отклонять неизвестную версию формата ошибкой `UnsupportedManifestVersionError`. |
| M-5 | Множества `classes` и `safelist` компонента SHOULD быть дизъюнктны; пересечение записывается в `warnings` манифеста как `safelist-redundant`. |
| M-6 | Манифест MUST публиковаться через `exports["./granum.manifest.json"]`, чтобы приложение находило его через `import.meta.resolve` без вычисления `packageBaseUrl` (INV-LAY-2). |
| M-7 | Правила движка провайдера (`engine`) MUST ссылаться на JS-модуль по относительному пути (`engineModule`), а не встраиваться в JSON. |

---

## 8. Резолвер (`.` / `./core`)

Порт `src/core` пресета v1 с заменой входа: вместо объектов провайдеров — манифесты
(объектная форма сохраняется для тестов и локальной разработки).

| ID | Требование |
|---|---|
| R-1 | `resolveGranum(input)` MUST быть чистой функцией над `{ providers: (GranumProvider \| GranumLoadedManifest)[], components?, themes? }` без обращения к FS и сети; результат — `GranumResolution`. `GranumLoadedManifest` — `{ manifest, baseUrl }`: JSON плюс директория файла как база путей. |
| R-2 | `Resolution` MUST содержать: упорядоченный список провайдеров, реестр компонентов, селекцию после транзитивного замыкания в post-order DFS (INV-SEL-2), активный набор тем с источником (`namesSource`), слои токенов и эффективные значения по темам, объединённые множества классов и safelist по компонентам, список CSS-ссылок в порядке эмиссии, предупреждения. |
| R-3 | Резолюция MUST мемоизироваться по идентичности объекта конфига; все каналы одного билда MUST использовать один и тот же объект `Resolution` (INV-RES-1). |
| R-4 | Ошибки резолюции MUST быть типизированы и нести структурные поля (§14). |
| R-5 | Вычисление эффективного значения токена MUST выполняться одной функцией (`tokenLayers`), которую используют эмиссия CSS, отчёт, `granum tokens` и prune (INV-THM-3). |
| R-6 | Резолвер MUST принимать смешанный вход: манифесты и объекты `GranumProvider`; обе формы нормализуются в `ProviderNode`, и всё ядро ниже работает только с узлами. Для объектной формы `./node` идёт медленным путём: если `baseUrl` — существующий каталог, файлы компонентов под `components/<Name>/` и достижимые общие чанки сканируются экстрактором движка и `scanTokenConsumption`, объявления темы — по файлам, и провайдер подаётся в резолвер синтетическим манифестом (предупреждение `provider-scanned`: графа бандлера нет, рёбра не проверяются). Если каталога нет, поля `classes` и `tokens.consumes` остаются пустыми с предупреждением `provider-without-manifest`. Отброшенный `strictTokens` override — предупреждение `override-skipped` в резолюции, а не `console.warn`. |

---


## 14. Ошибки

Каждая ошибка — класс из `src/core/errors.ts` (или модуля канала) со структурными
полями. Обнаружение как можно раньше: регистрация → резолюция → сборка провайдера →
сборка приложения.

| Условие | Ошибка | Когда |
|---|---|---|
| `contractVersion !== 1` | `UnsupportedContractVersionError` | регистрация |
| неизвестная версия формата манифеста | `UnsupportedManifestVersionError` | чтение манифеста |
| манифест не найден через `exports` | `ManifestNotFoundError` | загрузка конфига |
| манифест не проходит схему / хеш не совпадает | `InvalidManifestError` (`reason`) | чтение манифеста |
| путь в манифесте абсолютный или с `..` | `InvalidManifestError` (`path-escapes-package`) | чтение манифеста |
| пустой / невалидный `id` | `InvalidProviderError` (`invalid-id`) | регистрация |
| `baseUrl` не URL / без `/` | `InvalidProviderError` (`invalid-base-url`, `base-url-not-a-directory`) | регистрация |
| запись `dependencies` не инстанс и не непустая строка | `InvalidProviderError` (`invalid-dependency`) | регистрация |
| `cssFiles` дескриптора вне `components/<Name>/` | `InvalidProviderError` (`css-file-escapes-component`) | регистрация |
| ключ токена с `--` | `InvalidTokenKeyError` | регистрация |
| два инстанса с одним `id` | `DuplicateProviderIdError` | регистрация |
| два компонента с одним именем | `DuplicateComponentNameError` | регистрация |
| имя компонента — невалидный сегмент пути | `InvalidComponentNameError` | регистрация |
| цикл в `provider.dependencies` | `CircularProviderDependencyError` | регистрация |
| строковая зависимость не удовлетворена | `UnresolvedProviderDependencyError` | регистрация |
| ключ селекции не `providerId:Name` | `InvalidComponentKeyError` | селекция |
| провайдер не зарегистрирован | `ProviderNotRegisteredError` | селекция |
| компонент не найден | `ComponentNotFoundError` (со списком имеющихся) | селекция |
| цикл в `component.dependencies` | `CircularDependencyError` (цепочка) | селекция |
| неучтённое ребро графа компонентов | `UndeclaredDependencyError` | сборка провайдера |
| `exports` без манифеста или subpath компонента | `PackageExportsError` | сборка провайдера |
| браузерный чанк импортирует node-entry granum или `node:` | `BoundaryViolationError` | сборка провайдера |
| CSS-файл манифеста отсутствует | `CssReadError` (провайдер, секция, субъект, `cause`) | сборка приложения |
| strict-разбор `tokenDefinitionsRef` не удался | `TokenParseError` внутри `TokenRefError` | сборка провайдера |
| импорт компонента вне селекции при `guard: 'error'` | `ComponentOutsideSelectionError` (импортёр) | сборка приложения |
| форма конфига невалидна | `InvalidConfigError` (путь до поля) | загрузка конфига |
| codegen: несовпадение имени экспорта, маркеры, `exports` | `GranumCodegenError` (`reason` как в v1) | codegen |

Предупреждения (не ошибки, попадают в отчёт и `doctor`): `safelist-redundant`,
`default-theme-without-source`, `provider-without-manifest`, `token-undefined`,
`token-conflict`, `unmatched-class`, `token-pruned`.

---
