# Реестр инвариантов

Инвариант — утверждение, которое обязано быть верным в любой момент работы конвейера.
Каждый имеет владельца (модуль, который его гарантирует) и проверку (тест, проверка
типов, ошибка регистрации или `doctor`). Критерий приёмки AC-11: у каждого инварианта
заполнена колонка «Проверка», и она называет тест, скрипт проверки или файл ожиданий —
`invariants.test.ts` сверяет, что названные файлы существуют. Номер инварианта живёт
здесь, а не в коде.

Колонка «Источник»: `v1 §N` — унаследован из SPEC пресета v1; `new` — введён granum;
`v1 §N, усилен` — был в v1 как предупреждение или соглашение, стал ошибкой.

## Контракт (`INV-CON-*`)

| ID | Инвариант | Источник | Владелец | Проверка |
|---|---|---|---|---|
| INV-CON-1 | `id` провайдера непуст, без пробелов и уникален в графе приложения; два разных инстанса с одним `id` — ошибка | v1 §3 | `./contract`, резолвер | `defineGranumProvider` бросает `InvalidProviderError`; `expandProviders` — `DuplicateProviderIdError`; unit; `contract.test.ts`, `scanProvider.test.ts` |
| INV-CON-2 | Имя компонента уникально в провайдере и является валидным сегментом пути (`/^[A-Za-z][\w-]*$/`) | v1 §4, усилен | `./contract` | `DuplicateComponentNameError`, `InvalidComponentNameError`; unit; `contract.test.ts`, `vitePlugin.test.ts` |
| INV-CON-3 | `contractVersion` сравнивается строго; большее значение — тоже ошибка | v1 §2 | `./contract` | `UnsupportedContractVersionError`; unit; `contract.test.ts` |
| INV-CON-4 | `safelist` содержит только собственные классы, недоступные статике; пересечение со статикой фиксируется как `safelist-redundant` | v1 §4, усилен | `./build` | `buildPlugin.test.ts`; `fixtures/heavy-package/expected-manifest.mjs` (`safelist-redundant` у XhButton); `doctor` |
| INV-CON-5 | Объявленный граф `dependencies` покрывает фактические импорты между директориями компонентов (включая через общие чанки) | v1 §4.1, усилен | `./build` | `UndeclaredDependencyError` по графу модулей; интеграционный тест на фикстуре с намеренно пропущенным ребром; `fixtures/extra-simple-package/expected-manifest.mjs`, `fixtures/heavy-package/expected-manifest.mjs` |
| INV-CON-6 | Общий модуль, лежащий ВНЕ `components/<Name>/`, ребром графа не является, сколько бы компонентов его ни брали; импорт файла из чужой директории компонента — ребро, даже если это хелпер или константа (на бандле их не отличить) | v1 §4.1, уточнён | `./build` | `buildGraph.test.ts`: фикстура `overlayZ` (общий модуль вне `components/`) не даёт ребра; `buildPlugin.test.ts`: импорт из `components/Card/` без объявления — `UndeclaredDependencyError` |
| INV-CON-7 | Ключи токенов без `--`; префикс добавляет генератор | v1 §6.1, усилен | `./contract` | `InvalidTokenKeyError` при регистрации; unit; `contract.test.ts`, `manifest.test.ts` |
| INV-CON-8 | Объявление зависимости провайдера не выбирает компоненты донора | v1 §3.2 | резолвер | `invariantsCoverage.test.ts` |
| INV-CON-9 | Кросс-провайдерный донор перечислен в `peerDependencies` провайдера | v1 §3.2 | `./build` | `findMissingPeers` (`invariantsCoverage.test.ts`); предупреждение `peer-missing` в манифесте и в `doctor` |
| INV-CON-10 | Хелперы `define*` чисты: не читают FS и не имеют побочных эффектов | new | `./contract` | `scripts/check-dist-boundary.mjs` (браузерные entry без `node:`); `contract.test.ts` |

## Раскладка и границы (`INV-LAY-*`, `INV-BND-*`)

| ID | Инвариант | Источник | Владелец | Проверка |
|---|---|---|---|---|
| INV-LAY-1 | Для каждого компонента существует `components/<Name>/index.js`, и его SFC-код лежит под этой директорией | v1 §7.1 | `./build` | плагин формирует entry и chunkFileNames; `doctor` проверяет на `dist`; интеграционный тест; `fixtures/simple-package/expected-manifest.mjs`, `buildLayout.test.ts` |
| INV-LAY-2 | Манифест лежит в корне раскладки и экспортируется как `./granum.manifest.json`; база путей — директория манифеста | new | `./build`, `./codegen` | `PackageExportsError` при сборке; тест разрешения через `import.meta.resolve`; `codegen.test.ts`, `manifest.test.ts` |
| INV-LAY-3 | В собранном коде провайдера нет `data:`-URL на месте путей пакета | v1 §3.1 | `./build` | `analyzeBundle` (`data-url` в `BoundaryViolation`); `scripts/verify-fixture.mjs` — grep `data:text/css` по файлам компонентов |
| INV-LAY-4 | Общие чанки группы лежат в `groups/<g>/shared/`; общие чанки вне групп — в `chunks/`. Общий чанк входит в файлы каждого дотянувшегося компонента, а рёбра находятся сквозь него, а не от него. Встроенный контракт granum — отдельно, в `granum/contract.js`: это не код компонента, в `files` и классы компонентов он не входит | v1 §7.2, уточнён | `./build` | `buildLayout.test.ts` (`chunkFileNames`); `buildGraph.test.ts` (общий модуль ребром не считается, рёбра транзитивны); `buildPlugin.test.ts` и `buildWatch.test.ts` (встроенный контракт) |
| INV-BND-1 | Браузерные entry (`.`, `./contract`, `./engine`, `./runtime`) и браузерный код провайдера не импортируют `node:*` и node-entry granum | v1 §9, усилен | `./build`, CI пакета | `BoundaryViolationError` при сборке провайдера; тест на `dist` granum: grep `node:` в браузерных бандлах пуст; `scripts/check-dist-boundary.mjs`, `extract.test.ts` |
| INV-BND-2 | Точка входа `./vite` и `./build` не импортируют `unocss`, `@unocss/*` | new | пакет | тест на `dist`; `dependencies` пусты (INV-DEP-1); `scripts/check-dist-boundary.mjs` |

## Манифест (`INV-MAN-*`)

| ID | Инвариант | Источник | Владелец | Проверка |
|---|---|---|---|---|
| INV-MAN-1 | Манифест порождается только сборкой; ручная правка обнаруживается по `hash` | new | `./build`, читатель | `InvalidManifestError(hash-mismatch)`; unit; `manifest.test.ts` |
| INV-MAN-2 | Все пути относительны к манифесту, без `..`, без абсолютных, POSIX; `%2e` — та же точка, что и для парсера URL (`%2e%2e` — это `..`) | new | писатель, читатель | `InvalidManifestError(path-escapes-package)`; unit; `manifest.test.ts`, `buildPlugin.test.ts` |
| INV-MAN-3 | Версия формата и версия контракта присутствуют; неизвестная версия формата отклоняется | new | читатель | `manifest.test.ts`: `UnsupportedManifestVersionError` |
| INV-MAN-4 | `classes` и `safelist` компонента дизъюнктны **по построению**: запись safelist, которую нашло извлечение, в манифест не едет, а число вычищенных печатается строкой лога. Предупреждения на пересечении нет — видимость класса решает раскладка чанков бандлером, а не автор пакета | new, переосмыслен в 0.4.0 | `./build` | `buildPlugin.test.ts` и `scanProvider.test.ts`: пересечение вычищено, `warnings` пусты; `expected-manifest.mjs` фикстур |
| INV-MAN-5 | `classes` компонента равны множеству токенов, которые экстрактор движка извлекает из `files` в `dist` и для которых у движка есть правило; иных источников классов у манифеста нет | new | `./build` | round-trip в `scripts/verify-fixture.mjs`: извлечение по `files` из `dist` даёт то же множество |
| INV-MAN-6 | `tokens.consumes` = все `var(--x)` из CSS компонента и `files` плюс литералы `'--x'` из `files` | new | `./build` | round-trip в `scripts/verify-fixture.mjs` |
| INV-MAN-7 | `entry` компонента ровно `components/<Name>/index.js` | new | писатель, читатель | `InvalidManifestError(entry-layout)`; `manifest.test.ts` |
| INV-MAN-8 | Всё, что приложению нужно знать о провайдере, есть в манифесте; при совпадении отпечатков словаря приложение не читает JS провайдера ради резолюции (при расхождении читает — это и есть пересчёт, INV-ENG-11) | new | `./vite` | `invariantsCoverage.test.ts`: пустые JS-заглушки дают тот же CSS |
| INV-MAN-9 | Манифест записывает движок, которым он порождён; приложение не догадывается о нём по косвенным признакам | new | `./build`, читатель | `manifest.test.ts`: без блока `engine` чтение падает |

## Резолюция и селекция (`INV-RES-*`, `INV-SEL-*`)

| ID | Инвариант | Источник | Владелец | Проверка |
|---|---|---|---|---|
| INV-RES-1 | За один билд существует ровно одна `Resolution`, и все каналы читают её; мемоизация по идентичности конфига | v1 (архитектура) | резолвер, `./vite` | `resolve.test.ts` — мемоизация по идентичности входа; единственность в билде держит кэш `prepareApp` в плагине (`vitePlugin.test.ts`), отдельные вызовы ради реестра (резолвер авто-импорта) в эмиссии не участвуют |
| INV-RES-2 | Резолвер чист: без FS, сети, времени, случайности; одинаковый вход — глубоко равный выход | new | резолвер | unit; тест, что `./core` не импортирует `node:`; `resolve.test.ts` |
| INV-RES-3 | Эффективное значение токена вычисляется одной функцией для эмиссии, отчёта, CLI и prune | v1 §6.3 | резолвер (`tokenLayers`) | `architecture.test.ts`: `effective` пишет только `tokenLayers.ts`, потребители читают цепочки резолюции; `diagnostics.test.ts` (override виден в `explain`/`tokens` тем же значением) |
| INV-SEL-1 | Разделитель ключа `providerId:Name` — последнее двоеточие; обе части непусты | v1 §5.1 | резолвер | `InvalidComponentKeyError`; unit с `a:b:C`; `resolveSelection.test.ts` |
| INV-SEL-2 | Транзитивное замыкание — post-order DFS: зависимости раньше зависящих; порядок нормативен для токенов и CSS | v1 §5.2 | резолвер | unit на порядок; снапшот порядка CSS; `expandProviders.test.ts`, `resolve.test.ts` |
| INV-SEL-3 | Цикл в зависимостях компонентов или провайдеров — ошибка с полной цепочкой | v1 §5.2, §3.2 | резолвер | `CircularDependencyError`, `CircularProviderDependencyError`; unit; `expandProviders.test.ts`, `resolveSelection.test.ts` |
| INV-SEL-4 | Короткая форма `'Name'` допустима только в `dependencies` компонента, не в селекции приложения | v1 §4.1 | резолвер | `InvalidComponentKeyError`; unit; `resolveSelection.test.ts` |
| INV-SEL-5 | В режиме `components: 'imports'` селекция ⊇ множество компонентов, импортированных приложением; guard гарантирует ⊆ при `'error'` | new | `./vite` | интеграционный тест: импорт вне селекции при явном списке → ошибка; при `'imports'` → входит в селекцию; `vitePlugin.test.ts` |

## Темы и токены (`INV-THM-*`, `INV-TOK-*`)

| ID | Инвариант | Источник | Владелец | Проверка |
|---|---|---|---|---|
| INV-THM-1 | Активный набор тем определяется в порядке: `themes.names` (включая `[]`) → ключи `themes.define` → объединение `defaultThemes` всех провайдеров графа → `['light']`; источник фиксируется в `namesSource` | v1 §6.2 | резолвер | unit на все четыре ветви; `resolveThemes.test.ts` |
| INV-THM-2 | Приоритет значений токена: `theme.tokenDefinitions` провайдера < `tokenDefinitions` компонентов в порядке селекции < `themes.define` < `themes.tokenOverrides` | v1 §6.3 | резолвер | unit; `granum tokens --deep` показывает цепочку; `themeFileOverrides.test.ts` и `scripts/e2e-dev.mjs` — каскад поверх темы-файла |
| INV-THM-3 | При `strictTokens` override токена, не объявленного пакетным слоем (структурно или файлом темы), отбрасывается и не попадает в CSS; отчёт и эмиссия дают одно значение | v1 §6.3 | резолвер | unit; снапшот CSS; `resolve.test.ts`, `tokenLayers.test.ts` |
| INV-THM-4 | Структурное определение темы побеждает CSS-файл той же темы; файл не читается | v1 §6.3 | резолвер, сборщик CSS | unit; тест, что файл не открывался (mock FS); `resolveThemes.test.ts` |
| INV-THM-5 | Читаются только ссылки на темы, которые могут стать активными; сломанная ссылка неактивной темы не валит сборку | v1 §6.4 | `./build` (материализация) | `materializeRefs.test.ts` |
| INV-THM-6 | `tokenDefinitionsRef` со `strict: true` (по умолчанию): нет селектора или неподдерживаемая вложенность — ошибка, не пустая тема | v1 §6.4 | `./build` | `TokenParseError`; unit; `materializeRefs.test.ts` |
| INV-THM-7 | Манифест тем описывает активацию так, что её можно и применить, и прочитать обратно: тема, записанная в разметку по `activation`, распознаётся по ней же | new | `./runtime` | `verify-ssr.mjs`: сервер пишет активацию, клиентское чтение возвращает ту же тему |
| INV-THM-8 | Контроллер, поднятый поверх уже применённой темы, не меняет состояние корня: серверный кадр и первый клиентский совпадают | new | `./runtime` | `verify-ssr.mjs`: старт контроллера не трогает корень, переключение трогает |
| INV-THM-9 | `./runtime` работает в Node без DOM: контроллер конструируется, отвечает на запросы и молча не применяет тему | new | `./runtime` | `verify-ssr.mjs` под `document === undefined` |
| INV-TOK-1 | `pruneTokens.mode: 'off'` не меняет эмиссию ни на байт и не читает лишних файлов | v1 (gotchas) | `./vite` | снапшот CSS off vs baseline; mock FS; `apps/bench-one/expected.mjs`, `emitCss.test.ts` |
| INV-TOK-2 | Обрезка никогда не удаляет токен, достижимый от корней: потребление в CSS селекции (CSS компонентов, утилиты и preflight движка), `consumes` и `dynamic` манифестов, исходники приложения, `keep` | v1 (prune), усилен | `./vite` | unit на граф достижимости; фикстура с `dynamicTokens`; `diagnostics.test.ts`, `emitCss.test.ts` |
| INV-TOK-3 | Достижимость считается по графу «токен → токены в его значении», корни — только потребление вне значений custom properties | v1 (measuring) | `./node` | unit с цепочкой `--soft → --danger`; `tokenPrune.test.ts` |
| INV-TOK-4 | Токен, потребляемый без fallback и не объявленный ни одним слоем для активной темы, попадает в отчёт как `token-undefined` | v1 §10 | `./vite`, `doctor` | `diagnostics.test.ts` (`undefinedTokens`); `apps/bench-one/expected.mjs` (`tokens.undefined` пуст) |

## CSS (`INV-CSS-*`)

| ID | Инвариант | Источник | Владелец | Проверка |
|---|---|---|---|---|
| INV-CSS-1 | Порядок слоёв фиксирован и объявлен первой строкой вывода: `tokens, base, themes, components, utilities` | v1 §8, переосмыслен | сборщик CSS | снапшот; тест, что первая строка — `@layer …;`; `apps/app-1/expected.mjs`, `apps/bench-one/expected.mjs` |
| INV-CSS-2 | Внутри слоёв порядок нормативен: провайдеры в порядке графа; темы — по каждой теме её файлы с дедупом по пути, затем её структурные блоки; компоненты — в порядке селекции; утилиты — в порядке правил движка | v1 §8 | сборщик CSS | снапшот на фикстуре с тремя провайдерами; `themeFileOverrides.test.ts` — блоки темы после её файла и до файла следующей |
| INV-CSS-3 | Вход движка = ∪(classes селекции) ∪ ∪(safelist селекции) ∪ классы `appSources`; ничего сверх | new | `./vite` | unit на сборку входа; тест, что класс из невыбранного компонента не даёт CSS; `emitCss.test.ts` |
| INV-CSS-4 | Конкатенация `virtual:granum/layers/*.css` в порядке слоёв побайтно равна `virtual:granum.css` | new | `./vite` | `emitCss.test.ts`; `vitePlugin.test.ts` (A-12) |
| INV-CSS-5 | CSS компонентов проходит побайтно, кроме раскрытия `@apply` и обрезки токенов; один и тот же CSS не доставляется дважды (импорт из чанка + инлайн) | v1 §8, gotchas | `./build`, `./vite` | снапшот; `buildGraph.test.ts` — `cssImportedByChunk` у чанка, который сам импортирует свой CSS; `buildPlugin.test.ts` — то же, когда CSS вшивает плагин с `enforce: 'post'` (в объекте бандла этого не видно, проверяется по записанным файлам); `diagnostics.test.ts` — доведение `css-double-delivery` до `doctor` |
| INV-CSS-6 | Утилита приложения перебивает базовый стиль компонента: слой `utilities` позже `components`; нелейерный CSS приложения перебивает всё | new (ADR-4) | сборщик CSS | `emitCss.test.ts` (порядок слоёв); `scripts/e2e-dev.mjs` — computed `gap` элемента до и после появления утилиты приложения, джоба CI `e2e` |
| INV-CSS-7 | Одно правило эмитируется один раз независимо от числа источников класса | new | движок, сборщик | `invariantsCoverage.test.ts` |
| INV-CSS-8 | Preflight движка лежит в слое `base` и первым в нём: до CSS компонентов и до `base.css` провайдеров. В `utilities` его нет | new | сборщик CSS | `emitCss.test.ts`: reset движка стоит перед `base.css` провайдера и отсутствует в слое утилит |
| INV-CSS-9 | При `css.split` каждый непустой слой — отдельный ассет со своим хешем; правка, затрагивающая один слой, меняет имя одного ассета, остальные остаются побайтно теми же. Объявление порядка одно и приходит первым | new | `./vite` | `vitePlugin.test.ts`: состав ассетов и порядок ссылок; стенд `apps/bench-split` — две сборки и сравнение имён |

## Движок (`INV-ENG-*`)

| ID | Инвариант | Источник | Владелец | Проверка |
|---|---|---|---|---|
| INV-ENG-1 | Движок чист и детерминирован; без глобального состояния между вызовами | new | `./engine` | тест двух вызовов; тест параллельных вызовов; `engine.test.ts` |
| INV-ENG-2 | Каждый класс входа либо в `matched`, либо в `unmatched`; их объединение равно входу | new | `./engine` | `engine.test.ts` |
| INV-ENG-3 | Порядок правил: встроенные < провайдеров (по графу) < приложения; последнее совпавшее побеждает | v1 (preset.ts) | `./engine` | unit на переопределение `p-4` провайдером; `engine.test.ts` |
| INV-ENG-4 | Для эталонного набора классов CSS встроенного движка равен снапшоту `unocss@66.7.5 + presetMini + extra-rules` | new | `./engine` | golden-тест; снапшот пересоздаётся скриптом только вручную; `golden.test.ts` |
| INV-ENG-5 | Экстрактор не извлекает классы из комментариев SFC и из строк, которые не являются классами по синтаксису | v1 (gotchas), усилен | `./engine` | unit с фикстурами из `bench-one/App.vue`; `engine.test.ts`, `apps/app-3/expected.mjs` |
| INV-ENG-6 | Код движка не попадает в клиентский бандл приложения | new | пакет | `scripts/report-css-budget.mjs` (`granum.noEngineInBundle` в `expected-budget.mjs` стендов): ищутся литералы имени и диалекта движка — идентификаторы минификатор переименовывает; `cssBudget.test.mjs` на минифицированном бандле движка |
| INV-ENG-7 | Диалект обозначает словарь: одинаковый набор генерируемых имён — один диалект; опция, меняющая набор качественно, меняет диалект | new | движки | `engine.test.ts` пакета движка: `extraRules` меняет диалект, `variablePrefix` — нет |
| INV-ENG-8 | Правила провайдера исполняются только движком объявленного диалекта; иначе не загружаются, а зависящие классы попадают в `unmatched` | new | `./node` | `dialects.test.ts`: чужой диалект — `rulesSkipped`, вклад пуст |
| INV-ENG-9 | Ядро не содержит реализации движка: ни вендоренного кода, ни правил, ни пресетов | new | пакет | `entries.test.ts` на состав `./engine`; `check:boundary` на `dist` |
| INV-ENG-10 | Ни один артефакт не приписывает себе чужой словарь: диалект и отпечаток манифеста равны диалекту и отпечатку движка сборки, либо оба `null` при отсутствии классов и правил | new | `./build` | `buildPlugin.test.ts`: блок `engine` по факту сборки, `EngineDialectMismatchError` при противоречии |
| INV-ENG-11 | Списку классов манифеста приложение верит только при равенстве отпечатков; при различии список пересчитывается, и ни один класс не исчезает молча — ни потерянный, ни найденный | new | `./node` | `dialects.test.ts`: таблица решений §8, `lost` остаётся в `unmatched` |
| INV-ENG-12 | Ни одно решение не зависит от номера версии реализации: разные версии с одним отпечатком идут быстрым путём | new | `./node`, движки | `dialects.test.ts` и `engine.test.ts` пакета движка |

## JS-канал (`INV-JS-*`)

| ID | Инвариант | Источник | Владелец | Проверка |
|---|---|---|---|---|
| INV-JS-1 | `virtual:granum/components` содержит только реэкспорты и не имеет побочных эффектов; невостребованные экспорты вырезаются | new | `./vite` | `vitePlugin.test.ts` на форму модуля; стенд `apps/app-components` на настоящей сборке: в селекции два компонента, импортирован один, в бандле один |
| INV-JS-2 | При `guard: 'error'` ни один модуль приложения не импортирует директорию компонента вне селекции и не берёт компонент из корня пакета-провайдера | new | `./vite` | интеграционный тест; `vitePlugin.test.ts` и `viteDev.test.ts` — корень пакета |
| INV-JS-3 | Плагин не переписывает код провайдера и не меняет раскладку чанков приложения; при `guard: 'off'` и без виртуального модуля JS-бандл побайтно равен сборке без плагина | new | `./vite` | `scripts/compare-js.mjs` (AC-3) |

## Детерминизм и зависимости (`INV-DET-*`, `INV-DEP-*`)

| ID | Инвариант | Источник | Владелец | Проверка |
|---|---|---|---|---|
| INV-DET-1 | Манифест канонически сериализован; повторная сборка без изменений даёт побайтно тот же файл | new | `./build` | `scripts/check-determinism.mjs` по фикстурам |
| INV-DET-2 | CSS и отчёт приложения детерминированы при одинаковом входе | new | `./vite` | `scripts/check-determinism.mjs`: повторная сборка `bench-one` |
| INV-DET-3 | Ни один вывод не зависит от порядка обхода FS или порядка ключей объектов конфига | new | все | сортировка на границах; тест с перемешанным порядком `providers` при одинаковом графе; `manifest.test.ts`, `resolve.test.ts`; `vitePlugin.test.ts` — отчёт при любом порядке окружений сборки |
| INV-DEP-1 | `dependencies` пакета пусты; `peerDependencies` — только `vite`; `dist` не содержит импортов `unocss`, `@unocss/*`, `magic-string`, `css-tree` | new | пакет | тест на `package.json` и grep по `dist`; `scripts/check-dist-boundary.mjs`, `packageJson.test.ts` |

## Диагностика (`INV-DIAG-*`, `INV-ERR-*`)

| ID | Инвариант | Источник | Владелец | Проверка |
|---|---|---|---|---|
| INV-DIAG-1 | Отчёт и CLI вычисляются теми же функциями, что и эмиссия; отчёт не может назвать значение, которого нет в сборке | v1 §6.3 | `./node` | `architecture.test.ts`; `diagnostics.test.ts` (конфликты и prune из тех же слоёв и `planTokenPrune`) |
| INV-DIAG-2 | Класс без правила никогда не отбрасывается молча: класс пакета — в `unmatched` отчёта и в `doctor`; класс из атрибута класса разметки приложения, которого нет ни у движка, ни в CSS сборки, — в `unmatched` отчёта с файлом. Прочие слова исходников приложения классами не считаются и не судятся | new | движок, `./vite` | unit; интеграционный тест с `shadow-legacy` из фикстуры; `vitePlugin.test.ts` и `emitCss.test.ts` — разметка приложения; `extract.test.ts` — где в файле разметка (литералы JS/TS, `<script>`, frontmatter) |
| INV-DIAG-3 | Каждая ситуация, которую v1 ловил `console.warn` (пропущенная директория, `data:`-база, отсутствие `content`), в granum — либо ошибка типа, либо ошибка регистрации/сборки, либо строка отчёта | new | все | таблица §14 ТЗ ↔ тесты; ревью; `errors.test.ts`, `resolve.test.ts` |
| INV-DIAG-4 | Вердикт `token-undefined` выносится по множеству «нужен извне»: потребление с fallback, присваивание самим компонентом и `dynamicTokens` находкой не являются; отчёт сборки и доктор считают его одинаково | new | `./build`, `./node` | `tokenScan.test.ts`; `diagnostics.test.ts` — находка только по `requires` |
| INV-DIAG-5 | Текстовый вывод доктора не растёт линейно по числу находок: ошибки целиком, предупреждения сводкой по кодам, перечисления счётчиком, список компонентов суммами; `--code`/`--component`/`--components` разворачивают | new | `./node` | `diagnostics.test.ts` — таблица при 70 предупреждениях, ошибка выше таблицы |
| INV-DIST-1 | Аудит дистрибутива судит по манифестам и собранному CSS, а не по именам файлов и не по JS, и наводится на любое приложение, собранное granum: невыбранный компонент вырезан целиком; класс, общий с выбранным, класс приложения и класс без правила движка находкой не считаются; при включённой обрезке недостижимых токенов пакета не остаётся | new | `./node`, CLI | `auditDist.test.ts` на синтетическом `dist`; `cli.test.ts` на коды возврата; стенд `apps/dist-audit` |
| INV-ERR-1 | Ошибки контракта обнаруживаются при регистрации, а не при первом обращении к FS | v1 §11 | `./contract`, резолвер | unit: `defineGranumProvider` с невалидным входом бросает без FS; `buildPlugin.test.ts`, `contract.test.ts` |
| INV-ERR-2 | Каждая ошибка — типизированный класс со структурными полями (провайдер, компонент, файл, `reason`, `cause`) | v1 §11 | все | тест: все классы ошибок наследуют `GranumError` и имеют `code`; `errors.test.ts`, `contract.test.ts` |
| INV-ERR-3 | Коды выхода CLI: `0` чисто, `1` при `error`, при `--strict` — и при `warn`; `2` — неверный вызов, включая неизвестный флаг и значение у булева флага | v1 §10 | CLI | `cli.test.ts` |
