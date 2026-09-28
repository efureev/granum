# Changelog

## 0.5.0 — 2026-09-28

Разделение CSS по слоям — пункт 2.1 роадмапа.

### Added

- **`css.split: true` — по ассету на каждый непустой слой** (A-21, INV-CSS-9).
  Один файл жмётся лучше, но инвалидируется целиком: правка разметки сбрасывает
  кеш токенов и тем, которые не менялись. При `split` каждый слой уезжает своим
  ассетом с собственным хешем, а `<link>` проставляются в HTML в порядке слоёв —
  порядок ссылок и есть порядок каскада. Объявление `@layer …;` остаётся одно и
  приходит первым: его несёт ассет входа.

  Границы: только сборка приложения, только при наличии HTML-точки входа (иначе
  предупреждение — ссылки проставить некуда и CSS не загрузится), в dev CSS
  по-прежнему приходит одним модулем. Плата — суммарный сжатый вес.

- `wrapLayer(layers, name, options, { declareOrder })` в `./node` — один слой как
  самостоятельный файл.
- Стенд `apps/bench-split` и `scripts/verify-split.mjs`: две сборки и сравнение
  имён ассетов. Правка класса в `App.vue` обязана менять один ассет из пяти.

### Fixed

- **`virtual:granum/layers/<layer>.css` отдавал тело слоя без обёртки `@layer`.**
  A-12 обещал, что конкатенация срезов равна целому, а на деле срез был
  нелейерным CSS: импортированный отдельно, он перебивал утилиты приложения
  вместо обратного. Теперь срез самодостаточен — своя обёртка `@layer`, а
  объявление порядка несёт срез первого непустого слоя, — и конкатенация срезов
  побайтно равна `virtual:granum.css`.

  Приложение, импортирующее срезы вместо целого, получит изменившийся CSS: раньше
  он был без слоёв, теперь со слоями. Это и есть починка, но вывод меняется.

## 0.4.0 — 2026-09-27

Диагностика на реальном масштабе и чистка safelist — горизонт 1 роадмапа закрыт.
Замеры ниже сняты на дизайн-системе из восьми пакетов и 116 компонентов.

### Breaking

- **`token-undefined` выносится по «нужен извне», а не по «потребляется».** Из
  требований вычитаются три случая, и каждый — объявление компонента о себе:
  **fallback** (`var(--x, 1px)` — значение записано в самом `var()`),
  **присваивание самим компонентом** (`--x:` в его CSS, ключом инлайн-стиля или
  утилитой `[--x:1px]`) и `dynamicTokens`. На дизайн-системе это 279 находок → 0,
  и единственная настоящая осталась видна (T-5, INV-DIAG-4).

  Множество считается на сборке пакета и лежит в манифесте как
  `tokens.requires` — поле необязательное, манифест формата 2 без него читается
  как прежде, и диагностика на нём смотрит весь `consumes`. Пакеты надо
  пересобрать, чтобы получить тихий доктор.

- **Запись safelist, которую извлечение и так нашло, в манифест не едет.**
  Раньше она ехала и порождала предупреждение `safelist-redundant`; теперь
  вычищается на сборке, а число вычищенных печатается строкой лога. На
  дизайн-системе safelist в манифестах 3479 → 430 записей, `safelist-redundant`
  136 → 0, CSS не изменился ни на байт (тот же хеш ассета).

  Предупреждение убрано вовсе: видит ли извлечение конкретный класс, решает
  раскладка чанков бандлером, а не автор пакета. Автор объявил «эти классы
  собираются в рантайме» и не соврал — совпадение обнаруживается на сборке,
  значит сборке и чистить.

- **Сканер токенов срезает комментарии** тем же хелпером, что экстрактор классов
  (D-6, INV-ENG-5). JSDoc про токен давал фантомное потребление: документация с
  ``var(--gr-z-*)`` порождала токен с именем-префиксом, объявить который не мог
  никто. Заодно **составное имя больше не даёт токена**:
  `var(--gr-${'{'}tone${'}'}-text)` не порождает `--gr-`.

### Added

- **`doctor --allow=<code,code>`** — записанный долг: находки этих кодов
  печатаются и считаются, но `--strict` на них не падает (D-7). Шов существует,
  чтобы вокруг доктора не заводили скрипт-обёртку: она неизбежно расходится с
  самим доктором. Неразрешённые предупреждения печатаются в stderr со счётчиками
  по кодам.
- **`doctor --code=<code>`, `--component=<providerId:Name>`, `--components`** —
  детали по требованию (D-8).
- `formatDoctorReport(report, options)` принимает те же опции программно.
- `DoctorDiagnostic.items` — перечисление находки отдельным полем, чтобы
  текстовый вывод мог свернуть его в счётчик, а `--json` отдавал целиком.

### Changed

- **Текстовый вывод доктора не растёт вместе с находками** (D-8, INV-DIAG-5): на
  дизайн-системе 450 строк → 24. Ошибки печатаются целиком и первыми,
  предупреждения сводятся в таблицу по кодам с числами в порядке серьёзности,
  перечисление внутри находки сворачивается до трёх элементов и счётчика, список
  компонентов — до сумм. `--json` не сворачивает ничего.
- Отчёт сборки считает `tokens.undefined` тем же правилом, что доктор: разойтись
  им больше нечем.
- `build` ядра ставит бит на `dist/bin.js`: npm ставит его сам при установке, а
  воркспейс-симлинк и `yarn link` отдавали файл без бита, и `granum doctor` падал
  с `Permission denied`.

## 0.3.0 — 2026-09-27

Движок получает шов для CSS базового уровня. Штатная реализация переименована:
`@feugene/granum-engine-mini` → `@feugene/granum-engine-wind` (ADR-10).

### Breaking

- **Preflight движка уезжает из слоя `utilities` в слой `base`.** `EngineOutput`
  получил необязательное поле `preflight`: движок сообщает, какая часть его CSS
  базового уровня — инициализация кастомных свойств, регистрации `@property`,
  reset, — а сборщик кладёт её в `granum.base` и **первой**, до `base.css`
  провайдеров и до CSS компонентов (E-15, INV-CSS-8). Раньше весь вывод движка
  попадал в `granum.utilities`; для движка без reset это работало, для движка с
  reset означало бы, что reset перебивает стили компонентов вместо того, чтобы им
  предшествовать.

  Шов сделан утверждением о **роде** CSS, а не о слое: имён слоёв движок
  по-прежнему не знает (E-13). Движок, поля не заполняющий, ведёт себя как
  прежде — ни одного байта разницы.

  Для приложения это меняет вывод: слой `base`, бывший пустым у провайдера без
  `base.css`, теперь объявляется блоком. Ожидания на строку
  `@layer granum.tokens,granum.base,granum.themes;` придётся поправить.

### Changed

- **Штатный движок — `@feugene/granum-engine-wind` `^0.3.0`** вместо
  `@feugene/granum-engine-mini`: он вендорит `preset-wind3`, где есть
  `border-collapse`, `list-none`, `touch-none` и `scroll-p*`, которых в
  `preset-mini` не было вовсе. Диалект стал `unocss/preset-wind3+granum@66`.
  Подробности и цена перехода — в CHANGELOG движка и ADR-10.
- **E-2 уточнено:** диалект обязана менять опция, меняющая набор генерируемых
  имён **или их смысл**. Прежняя формулировка говорила только о наборе, и
  доп-правило, которое меняет смысл существующего имени (альфа на произвольном
  цвете), формально под неё не попадало.
- Стенд `apps/app-dialects` переставлен на фикстуру `@granum-fixtures/atoms`:
  прежняя пара «движок с доп-правилами против движка без них» перестала давать
  расхождение наборов имён, и ветка таблицы §8 не проверялась бы. Заодно стенд
  теперь покрывает `engine-rules-skipped`.

## 0.2.0 — 2026-09-26

Ломающий выпуск: движок утилит уезжает из пакета, а диалект и отпечаток словаря
становятся объявленными величинами и записываются в манифест. Обратной
совместимости нет намеренно — `0.1.0` публиковался как проверка и потребителей не
имел. ТЗ изменения — `docs/spec-engine.md`, решения — ADR-8 и ADR-9.

### Breaking

- **`engine` в `granum.config.*` обязателен и принимает инстанс `GranumEngine`.**
  Строка `'builtin'` и объект опций больше не принимаются: выбор реализации и её
  настройка — дело приложения. Встроенный движок переехал в
  `@feugene/granum-engine-mini` (`miniEngine(options)`).
- **Правила приложения передаются фабрике движка, а не конфигу granum.** У
  конфига поля для правил нет и не появится: `miniEngine({ rules: [...] })`.
- **`granumProvider({ engine })` требует инстанс движка.** Диалект и отпечаток
  артефакта берутся из него; «движка по умолчанию» у сборки провайдера больше нет.
- **`provider.engine` принимает `{ dialect, rules?, variants?, preflights? }`.**
  Правила без объявленного словаря — ошибка регистрации `rules-without-dialect`.
  Утверждённый диалект сверяется с движком сборки: расхождение —
  `EngineDialectMismatchError`, а не молчаливая запись чужого словаря в манифест.
- **Версия формата манифеста — `2`.** Корневое `engineModule` заменено блоком
  `engine { dialect, vocabulary, name, version?, module }`. Читатель отклоняет
  версию `1` громко, без попытки прочитать.
- **`./engine` отдаёт только контракт и хелперы**: `GranumEngine`,
  `extractClasses`, `stripComments`, `parseDialect`, `vocabularyFingerprint`.
  `createEngine` и вендоренный код в ядре отсутствуют.

### Added

- **Отпечаток словаря как ключ доверия списку классов.** Список классов в
  манифесте — не свойство пакета, а результат фильтрации его кандидатов
  конкретной реализацией движка. При любом различии отпечатков granum
  пересчитывает классы пакета своим движком из `files` манифеста и называет
  разницу: `gained` — классы, которые сборка пакета потеряла, а движок
  приложения знает (прежде такая потеря молчала); `lost` — классы манифеста без
  правила у движка приложения. Потерянные подаются движку и остаются видны в
  `unmatched` — пересчёт не делает потерю тише, чем она была.
- **Загрузка правил пакета управляется диалектом, а не отпечатком**: правило
  написано против словаря и переживает смену реализации внутри мажора. Чужой
  диалект — правила не грузятся, предупреждение `engine-rules-skipped`.
- **Версия реализации в решениях не участвует** ни сравнением, ни диапазоном:
  патч без новых правил не стоит приложению пересчёта, минор с новыми — стоит, и
  различает это отпечаток, а не номер.
- Пакет без утилит получает `dialect: null, vocabulary: null` и работает с любым
  движком приложения без пересчёта.
- Отчёт сборки называет движок (`engine`) и решение по каждому провайдеру
  (`providers[]`); `doctor` — коды `provider-dialect-mismatch`,
  `provider-classes-recovered`, `provider-classes-dropped`,
  `engine-rules-skipped` и диалект с отпечатком рядом с формой провайдера;
  `why-css` объясняет непокрытый класс через словари и говорит, что делать.
- Руководство «Движки и диалекты» в `docs/ru` и `docs/en`.

### Fixed

- **Провайдер, объявивший правила движка, но не передавший `engineModule`, больше не теряет их
  молча.** Манифест ссылается на модуль, и без пути приложение правил не получало: свой CSS
  провайдер извлекал (правила известны сборке), а у потребителя те же классы не
  генерировались. Теперь сборка пишет предупреждение `engine-module-missing` в манифест и в
  лог (M-7, INV-DIAG-3).
- **Нарушения границы browser/node не переезжают в следующую пересборку.** Состояние
  сбрасывалось в `configResolved`, который в `vite build --watch` вызывается один раз на
  сессию, а `transform` при пересборке идёт только по изменённым модулям: старое нарушение
  продолжало ронять сборку после починки кода. Сброс переехал в `buildStart` (B-15).

### Changed

- **Нормативная часть ТЗ в пакете (`docs/SPEC.md`) порождается из `docs/spec.md`**, а
  расхождение роняет прогон (`yarn check:spec`). Опубликованная 0.1.0 несла устаревший R-6:
  там был описан прежний путь объектной формы провайдера, без сканирования раскладки.
- Формулировки, расходившиеся с кодом, приведены к фактическому поведению: C-5, C-10, C-11,
  C-14, C-17, C-19, B-2, B-4, B-5, B-9, B-13, B-17, M-3, M-7, R-3, R-6, таблица ошибок §14 и
  список предупреждений (он разделён на манифест, резолюцию и `doctor`; `unmatched-class` и
  `token-pruned` предупреждениями не были никогда — это поля отчёта).

## 0.1.0 — 2026-09-26

First release of the successor of `@feugene/unocss-preset-granular`. The
package has no dependencies (peer `vite ^8`), runs on Node ≥ 22, and ships
`docs/SPEC.md` and `MIGRATION.md`.

- Acceptance (stage 7): benchmark stands `apps/bench-{zero,one,pruned}` with a
  size budget (`scripts/report-css-budget.mjs`), CSS rule-set comparison of
  `bench-one` with the v1 preset snapshot (`compare-css.mjs`, 58 = 58 rules),
  byte comparison of the JS bundle with a build without the plugin
  (`compare-js.mjs`), determinism of the application CSS and report, user
  guides in `docs/ru` and `docs/en`, invariant registry with verification
  references and a test that every `INV-*` has one.
- Slow path for object-form providers (R-6): when `baseUrl` points at an existing `dist`,
  the application scans component files and reachable shared chunks with the engine
  extractor, collects consumed tokens and theme declarations, and feeds the resolver a
  synthetic manifest (`provider-scanned` warning; no bundle graph, so component edges
  are not verified). Instance donors of such providers are scanned too.
- Codegen: the provider registry target renders array entries (`xCardConfig,`) for
  `components: [ … ]` of the granum contract; the default `exports` entry points
  `import` at the flat `dist/components/<Name>/index.js` layout for grouped sources
  too; `--exports=import` / `entryStyle: 'import'` writes string subpaths without
  `types`. Fixture providers use marked blocks and `granum codegen --check` runs in
  `verify:fixtures`.
- Layer sizes in `granum-report.json` are now measured on the built CSS asset after
  minification, by `@layer` blocks (`sizesSource: 'bundle'`); the pre-minification
  emission sizes stay next to them as `emissionSizes`.
- `granumResolver(config, options)` from `./vite` for auto-import tools
  (`unplugin-vue-components` shape); in `components: 'imports'` mode PascalCase tags
  found in `appSources` join the selection when exactly one provider declares the name.
- In-process caches: manifests by file stat, engine output per class set — editing
  application sources in dev neither re-reads manifests nor regenerates the same
  utilities.
- Demo apps `app-2` (safelist of runtime-assembled classes plus `tokenOverrides`) and
  `app-4` (classes of nested SFC parts from the manifest plus the extra engine rules
  under `engine.variablePrefix`) ported from the v1 preset; all six v1 apps now run
  on granum.
- `granum codegen [<package-dir>] [--check] [--targets=barrel,exports,manifest,registry]`
  regenerates the standard provider registries from the command line; `--check`
  exits with `1` when they are stale.
- Diagnostics and CLI (stage 6): `granum doctor | explain | why-css | tokens | prune |
  report` work from manifests and `granum.config.*` without building the application
  (`report` reads `dist/granum-report.json`). `doctor` checks referenced files, `@apply`
  left in provider CSS, `!important`, the browser/node boundary of provider chunks,
  manifest warnings of selected components, dead safelist entries, undefined tokens,
  token conflicts and theme warnings; exit codes `0/1/2`, `--json`, `--strict`,
  `--deep`. `granum*` functions and `format*Report` formatters are exported from
  `./node`; the config loader (`loadGranumConfigFile`) too.
- Application plugin (stage 5): `granum(config)` Vite plugin orchestrates the pipeline
  from one resolution — `virtual:granum.css` with cascade layers `tokens, base, themes,
  components, utilities` (and per-layer slices), `virtual:granum/components` re-exporting
  the selection, `virtual:granum/themes` for the runtime, an import guard for components
  outside the selection, `components: 'imports'`, token pruning with app sources, and a
  build report (`granum-report.json`). `./runtime` ported (`createThemeController`).
  Demo apps `apps/app-{1,3,5,6}` with expectation-based verification.
- Provider build (stage 4): `granumProvider()` Vite plugin builds the entries from the
  component registry, routes chunks and CSS into the contract layout, analyses the
  bundle graph (component files, edges, undeclared dependencies), extracts classes
  and consumed tokens, copies declared CSS and theme files, expands `@apply`,
  materialises token refs, checks the browser/node boundary and `package.json#exports`,
  and writes `granum.manifest.json`. `./codegen` ported with a `manifestExport` target.
  `./node` gains CSS reading, token-set parsing, declaration scanning and token
  consumption scanning. Fixture providers rebuilt on the contract with manifest
  verification and a determinism check.
- Manifest (stage 3): `serializeManifest` / `writeManifestSync` produce the canonical
  `granum.manifest.json` with a content hash; `parseManifest` / `readManifestSync`
  validate format version, schema, package-relative paths, hash, entry layout and token
  keys in the documented order; `locateManifest` resolves a provider's manifest through
  its package `exports` without executing package code.
- Utility engine (stage 2): `createEngine()` on a vendored UnoCSS 66.7.5 core
  (`@unocss/core`, `preset-mini`, `rule-utils` without `magic-string`,
  `extractor-arbitrary-variants`) plus the rules of `@feugene/unocss-mini-extra-rules`
  ported onto it. `generate()` returns CSS, a `matched` map (rule, selector, source,
  layer) and `unmatched`; `extract()` ignores SFC, block and line comments. Output is
  byte-equal to `unocss` + `presetMini` + extra rules on the golden class set.
  `scripts/vendor-unocss.mjs` regenerates `src/engine/vendor/`; `THIRD_PARTY_NOTICES.md`
  ships with the package.
- Contract v1 and resolver (stage 1): `defineGranumProvider` validates at registration
  (id, contract version, component names as path segments, token keys without `--`,
  `cssFiles` inside the component directory); `defineGranumComponent` normalises
  `cssFiles` to `components/<Name>/<file>` and keeps `sourceUrl`. `resolveGranum`
  accepts provider objects and loaded manifests, memoises by input identity and
  returns one `GranumResolution` for all channels; token values come from a single
  `collectTokenLayers` / `resolveTokenValue`. All errors extend `GranumError` with a `code`.
- Repository skeleton: entry points, CLI shell, boundary checks (stage 0).
