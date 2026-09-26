# План реализации

Этапы идут строго последовательно по зависимостям данных: контракт → движок → манифест
→ сборка провайдера → приложение → диагностика → приёмка. Внутри этапа задачи можно
вести параллельно. Размер: S (до дня), M (до трёх дней), L (неделя и больше) — ориентир
для одного разработчика, не обязательство.

Определение готовности этапа (DoD) едино: задачи закрыты, перечисленные инварианты
имеют проверку, `yarn test:all` зелёный, документация этапа написана в `docs/ru` и
зеркально в `docs/en`.

## Раскладка репозитория

```
granum/
  package.json                 workspace: packages/*, fixtures/*, apps/*
  packages/granum/             сам пакет
    src/contract/  src/core/  src/engine/{vendor,rules,patches}/  src/build/
    src/vite/  src/node/  src/runtime/  src/codegen/  src/cli/
    docs/SPEC.md               нормативная спецификация (из spec.md после стабилизации)
  fixtures/
    simple-package/  extra-simple-package/  heavy-package/     провайдеры (порт из v1)
  apps/
    app-1..6/                  интеграционные тесты контракта (порт из v1)
    bench-zero/ bench-one/ bench-pruned/                     стенды веса
  scripts/                     compare-css.mjs, report-css-budget.mjs, check-docs-parity.mjs
  docs/ru/ docs/en/            руководства; docs/*.md — этот комплект ТЗ
```

## Этап 0 — Каркас (S) — выполнен 2026-09-25

| Задача | Результат |
|---|---|
| 0.1 Инициализировать репозиторий, Yarn 1 workspaces, TypeScript 6.x с `resolutions`, ESLint (`@antfu/eslint-config`), Vitest 4, Vite 8 | `yarn lint`, `yarn test` проходят на пустом пакете |
| 0.2 `package.json` пакета: `exports` для 8 entry + `bin`, `sideEffects: false`, `engines.node >= 22`, `publint` в CI | AC-8 частично |
| 0.3 Тест на зависимости: `dependencies` пусты, `peerDependencies` только `vite`, grep по `dist` на `unocss|@unocss|magic-string|css-tree|node:` в браузерных entry | INV-DEP-1, INV-BND-1, INV-BND-2 |
| 0.4 CI: jobs `docs-parity`, `test` (lint, typecheck, unit, scripts), `build` (publint, `check:boundary`), `contract` (build:all, doctor, verify, sizes), `publish-npm` по тегу | каркас всех проверок приёмки; `contract` до этапа 4 штатно пропускает пустые каталоги |
| 0.5 Скопировать комплект ТЗ в `docs/`, завести `docs/ru`, `docs/en`, `check-docs-parity` | N-8 |

## Этап 1 — Контракт и резолвер (M) — выполнен 2026-09-25

| Задача | Результат |
|---|---|
| 1.1 Перенести `src/contract` из v1: переименования (`defineGranum*`), удаление `packageBaseUrl`/`cssFileAssetNames`/`styleAssetFileName`, `unocss` → `engine` в типах granum, `dynamicTokens`, `baseUrl` для объектной формы | C-1…C-20 |
| 1.2 Проверки при регистрации: id, имя компонента как сегмент пути, ключ токена с `--`, версия контракта | INV-CON-1,2,3,7; INV-ERR-1 |
| 1.3 Перенести `src/core` (expandProviders, registry, resolveSelection, resolveThemes, tokenLayers, dedupe, errors, debug); заменить вход на `ManifestLike | GranumProvider` | R-1…R-6 |
| 1.4 Определить тип `Resolution` со всеми полями R-2; мемоизация по идентичности | INV-RES-1,2 |
| 1.5 Перенести тесты ядра v1 (8 наборов: expandProviders, providerValidation, resolveSelection, resolveThemes, tokenLayers, appThemes, contractHelpers, debug) с адаптацией входа; добавить тесты на новые ошибки, манифестную форму, мемоизацию, детерминизм | INV-SEL-*, INV-THM-1..4, INV-RES-1..3, INV-DET-3 |
| 1.6 Иерархия ошибок `GranumError` с `code`; тест, что все классы наследуют её | INV-ERR-2 |

## Этап 2 — Движок (L) — выполнен 2026-09-25

| Задача | Результат |
|---|---|
| 2.1 Вендорить `@unocss/core`, `preset-mini`, `rule-utils` (без `magic-string`), `extractor-arbitrary-variants` @66.7.5 в `src/engine/vendor/`; `THIRD_PARTY_NOTICES.md`; скрипт `scripts/vendor-unocss.mjs` с фиксированной версией; `check:vendor` в CI сверяет идемпотентность | ADR-2 |
| 2.2 Внутренние типы `GranumRule`, `GranumVariant`, `GranumPreflight`, `EngineTheme` (структурные, поверхность `./engine` не ссылается на vendor); импорты `@unocss/*` переписаны скриптом на относительные, единственный патч — `magic-string` | INV-DEP-1 |
| 2.3 Перенести правила `unocss-mini-extra-rules` (8 семейств) в `src/engine/rules/extra/` на внутренних типах; перенести их тесты | E-4 |
| 2.4 Реализовать `createEngine()` с `extract` и `generate` по §9.1; `matched`/`unmatched`; порядок правил | E-1…E-3, INV-ENG-1,2,3 |
| 2.5 Golden-тесты: эталонный набор классов фикстур v1 + арбитражные значения + варианты; живая сверка с `unocss@66.7.5` + `@feugene/unocss-mini-extra-rules@0.8.1` из devDependencies и файловый снапшот `golden.css` | E-5, INV-ENG-4 |
| 2.6 Экстрактор: кавычки, шаблонные литералы, `_` в арбитражных значениях, игнор комментариев SFC | E-6, INV-ENG-5 |
| 2.7 Тесты детерминизма и параллельных вызовов | INV-ENG-1 |

## Этап 3 — Манифест (S) — выполнен 2026-09-25

| Задача | Результат |
|---|---|
| 3.1 Тип `GranumManifest` в `./contract`; каноническая сериализация, `hash` | INV-DET-1, INV-MAN-1 |
| 3.2 `writeManifest` / `readManifest` в `./node` с валидацией по `manifest.md` §4 | INV-MAN-2,3,7 |
| 3.3 Fixtures манифестов (валидные, с каждым видом нарушения) и unit-тесты | M-1…M-7 |

## Этап 4 — Сборка провайдера (L) — выполнен 2026-09-25

| Задача | Результат |
|---|---|
| 4.1 Плагин `granumProvider()`: построение `lib.entry` из реестра, `chunkFileNames`/`assetFileNames` (порт `granularChunkFileNames`/`granularAssetFileNames`), копирование `cssFiles` (порт `granularCssAssetsPlugin`) | B-1…B-5, INV-LAY-1,3,4 |
| 4.2 Граф модулей → принадлежность модулей компонентам и группам; рёбра между компонентами; сравнение с `dependencies` → `UndeclaredDependencyError` | B-7, B-8, INV-CON-5,6 |
| 4.3 Извлечение классов по модулям компонента экстрактором движка; предупреждение `safelist-redundant` | B-6, INV-MAN-4,5 |
| 4.4 Скан токенов: `var(--x)` в CSS, литералы в JS, `dynamicTokens`; объявленные токены из CSS и `tokenDefinitions`; материализация `tokenDefinitionsRef` (порт `materializeRefs`, `tokenDefinitionsFromCss`) | B-9, B-10, INV-MAN-6, INV-THM-5,6 |
| 4.5 Раскрытие `@apply` для плоских правил движком; ошибка на вложенных | B-11, ADR-3 |
| 4.6 Эмиссия манифеста в `closeBundle`; режим `--watch` | B-12, B-15 |
| 4.7 Проверка границы на бандле: `node:` и node-entry granum в браузерных чанках; `data:`-URL | B-16, INV-BND-1, INV-LAY-3 |
| 4.8 Перенести `./codegen` из v1; добавить цель `exports["./granum.manifest.json"]` и entry-карту для 4.1 | B-13, B-14, INV-LAY-2 |
| 4.9 Перенести фикстурные провайдеры v1 в `fixtures/` (`@granum-fixtures/{simple,extra-simple,heavy}`) на новый контракт; `scripts/verify-fixture.mjs` + `expected-manifest.mjs` сверяют манифесты | AC-1 частично |
| 4.10 Round-trip: извлечение по `dist` даёт `classes` и `consumes` манифеста — обобщённая проверка в `verify-fixture.mjs` | INV-MAN-5,6 |
| 4.11 `scripts/check-determinism.mjs`: повторная сборка фикстур, манифест побайтно стабилен | INV-DET-1 |

## Этап 5 — Плагин приложения (L) — выполнен 2026-09-25 (5.12 e2e в браузере перенесён в этап 7)

| Задача | Результат |
|---|---|
| 5.1 `defineGranumConfig`, загрузка `granum.config.*`, рантайм-валидация формы, `InvalidConfigError` | A-1 |
| 5.2 Разрешение `providers` по строке через `import.meta.resolve` → `readManifest`; смешанный вход с объектами (медленный путь с предупреждением) | A-2, R-6, INV-MAN-8 |
| 5.3 CSS-канал: сборщик слоёв, чтение CSS по путям манифеста (порт `readCss` с LRU-кэшем), `virtual:granum.css` и `virtual:granum/layers/*.css`, плоский режим | A-9…A-15, INV-CSS-1..7 |
| 5.4 Вход движка: классы манифестов + safelist + извлечение из `appSources`; дедуп | A-11, INV-CSS-3 |
| 5.5 JS-канал: `virtual:granum/components`, guard в `resolveId`, резолвер для auto-import | A-5…A-8, INV-JS-1,2,3 |
| 5.6 Режим `components: 'imports'`: статический скан спецификаторов | A-3, INV-SEL-5, ADR-6 |
| 5.7 Канал токенов: prune (порт `tokenPrune`, `pruneCssDeclarations`, `cssDeclarations`), `virtual:granum/themes` (порт `themeManifest`) | T-1…T-5, INV-TOK-1..4 |
| 5.8 Dev: HMR по виртуальным модулям, кэш по `hash` манифеста, watcher на манифесты в монорепо, оверлей ошибок | A-16…A-18 |
| 5.9 Отчёт сборки `granum-report.json` с размерами слоёв (порт `cssBudget.mjs` в `./node`) | A-19, A-20, INV-DIAG-1,2 |
| 5.10 Перенести `./runtime` из v1 без изменений | RT-1, RT-2 |
| 5.11 Приложения `apps/app-{1..6}` на granum: без `unocss`, `granum.config.ts` + `granum()`; `expected.mjs` сверяет CSS, JS и отчёт (`scripts/verify-app.mjs`). `app-2` (safelist + `tokenOverrides`) и `app-4` (вложенные SFC + доп-правила под `variablePrefix`) перенесены после приёмки; стенды `bench-*` — этап 7 | AC-5 |
| 5.12 e2e в браузере: INV-CSS-6 (утилита перебивает базу), AC-9 (HMR) — перенесено в этап 7 (нужен браузер) | INV-CSS-6, AC-9 |

## Этап 6 — Диагностика и CLI (M) — выполнен 2026-09-25

| Задача | Результат |
|---|---|
| 6.1 Перенести `doctor`, `explain`, `tokens`, `prune` из v1 на вход из манифестов; добавить проверки манифестов, файлов, границы, `important-in-provider-css`, `apply-not-expanded` | D-1, D-2 |
| 6.2 `why-css` по карте `matched` движка | D-3 |
| 6.3 `report` по `granum-report.json` | D-1 |
| 6.4 `bin/granum`, коды выхода, `--json`, `--strict` | INV-ERR-3 |
| 6.5 Архитектурный тест (`architecture.test.ts`): `effective` записывает только `core/tokenLayers.ts`, никто не выводит значение из слоёв заново, потребители читают `tokenLayers` резолюции | INV-RES-3, INV-DIAG-1 |
| 5.13 A-8: `granumResolver` для auto-import и селекция по тегам разметки в режиме `'imports'`; A-17: кэш манифестов по stat и вывода движка по множеству классов в пределах процесса (добавлено после приёмки, `autoImport.test.ts`) | A-8, A-17 |
| 6.7 `granum codegen [<package-dir>] [--check] [--targets=…]` — стандартные цели B-14 из командной строки (добавлено после приёмки) | D-1, B-14 |
| 6.6 Загрузка `granum.config.*` для CLI: `.ts` через `vite.loadConfigFromFile`, если `vite` резолвится из корня приложения, иначе нативный `import()`; экспорт `default` / `granum` / `config` | D-4 |

## Этап 7 — Приёмка и релиз (M) — выполнен 2026-09-25

| Задача | Результат |
|---|---|
| 7.1 `scripts/compare-css.mjs`: нормализация CSS в множество `{selector, declarations}`; снапшот `bench-one` с v1 в `apps/bench-one/v1-snapshot.css` | AC-2 |
| 7.2 Сравнение JS-бандла `bench-one` с/без плагина | AC-3 |
| 7.3 Тест двойной сборки приложения | AC-6, INV-DET-2 |
| 7.4 Стенды и `sizes:check` по слоям | N-4, N-5 |
| 7.5 Таблица инвариантов: заполнить колонку «Проверка» ссылками на тесты; тест, что каждый `INV-*` из `invariants.md` упомянут хотя бы в одном тестовом файле | AC-11 |
| 7.6 `docs/ru` + `docs/en`: getting-started, authoring-providers, usage-in-apps, themes-and-tokens, architecture, cli, troubleshooting, measuring-weight, `MIGRATION.md` | N-8, AC-10 |
| 7.7 `SPEC.md` пакета из `spec.md` §5–§8, §14 (нормативная часть) | N-8 |
| 7.8 Релиз `0.1.0` (версия, CHANGELOG, `SPEC.md`, `MIGRATION.md` в пакете). Заметка в README v1 не внесена: репозиторий v1 по решению автора не изменяется | ADR-7 |
| 7.9 e2e в браузере на dev-сервере `apps/app-1` — автоматизирован: `scripts/e2e-dev.mjs` на playwright, девять проверок (порядок слоёв, базовый `gap` компонента, утилита `p-4`, раскрытый `@apply`, появление правила `.gap-0` по HMR, сохранность маркера в `window`, отсутствие перезагрузок, `gap` после правки). Своя джоба CI `e2e`, в `test:all` не входит: локальный прогон не должен тянуть браузер | INV-CSS-6, AC-9 |

## Этап 8 — Движок как выбор приложения (L)

ТЗ этапа — [`spec-engine.md`](./spec-engine.md); идентификаторы требований ниже
оттуда. Контракт ломается без обратной совместимости: `0.1.0` опубликован как
проверка и потребителей не имеет. Порядок шагов важен — каждый следующий
опирается на предыдущий, и до 8.10 нормативные разделы `spec.md` не трогаются.

| Задача | Результат |
|---|---|
| 8.1 Диалект в интерфейсе: `GranumEngine.dialect`, `parseDialect`, валидатор формата; `EngineInput`/`EngineOutput` без изменений | E-1, E-4 |
| 8.2 Новый пакет `packages/granum-engine-mini`: переезд `src/engine/{vendor,rules,builtin}`, `THIRD_PARTY_NOTICES.md`, `scripts/vendor-unocss.mjs`, golden-тест и `check:vendor`; фабрика `miniEngine(options)`, диалекты по `extraRules`; ядро оставляет типы, `extractClasses`, `parseDialect` | E-5, INV-ENG-4, INV-ENG-9 |
| 8.3 Ядро без движка: `./engine` только типы и хелперы; тест на состав экспортов и `check:boundary` на `dist` | INV-ENG-9, AC-E2 |
| 8.4 Конфиг приложения: `engine` обязателен и принимает инстанс; `'builtin'` и объект опций убраны; `InvalidConfigError` с путём до поля | A-E1, A-E2 |
| 8.5 Контракт провайдера: `provider.engine = { dialect, rules?, variants?, preflights? }`, `rules-without-dialect` и `invalid-dialect` при регистрации; `granumProvider({ engine })` требует инстанс; сверка утверждённого диалекта с движком сборки — `EngineDialectMismatchError` | C-E1…C-E4, INV-ENG-10 |
| 8.6 Манифест версии 2: блок `engine { dialect, name, version?, module }`, удаление `engineModule`, правила чтения включая `dialect-without-classes`; канонизация и хеш учитывают новый блок | M-E1…M-E4, INV-MAN-9 |
| 8.7 Сверка диалектов в приложении: решение до генерации, пересчёт классов из `files` движком приложения при несовпадении, `safelist` не пересчитывается, правила грузятся только при равенстве | A-E3…A-E6, INV-ENG-8, AC-E3 |
| 8.8 Диагностика: поля движка и по-провайдерные диалекты в отчёте, коды `provider-dialect-mismatch`, `provider-dialect-checked`, `engine-rules-skipped` в докторе, объяснение через диалекты в `why-css` | D-E1…D-E3 |
| 8.9 Фикстуры: `fixtures/atoms-engine` (движок ~80 строк для `granum-fixtures/atoms@1`), `atoms-package` (свой диалект + модуль правил), `plain-package` (диалект `null`, только свой CSS и токены); существующие четыре пересобираются `miniEngine()`; `expected-manifest.mjs` на блок `engine` у каждой | §12 ТЗ, AC-E4 |
| 8.10 Приложения: явный движок во всех существующих; новые `app-dialects` (движок без доп-правил против `heavy` с `divide-y` — ветка «наборы разошлись») и `app-atoms` (свой движок, пакет со своим диалектом плюс пакет без диалекта); `expected.doctor` на каждую ветку таблицы §8 | §13 ТЗ, AC-E1, AC-E5 |
| 8.11 Документы: нормативная часть переносится в `spec.md` (§5 контракт, §7 манифест, §9 движок, §10 конфиг, §14 ошибки), инварианты INV-ENG-7…10 и INV-MAN-9 в реестр, ADR-8, перегенерация пакетного `SPEC.md`, руководства `docs/ru` и `docs/en` | AC-E6 |
| 8.12 Релиз `0.2.0`: CHANGELOG с ломающими изменениями, тег, публикация | — |

Проверка готовности этапа, помимо обычного `yarn test:all`: каждая строка
таблицы решений §8 ТЗ имеет стенд или тест, и `heavy`, собранный одним движком,
читается приложением с другим без потери классов (AC-E3).

## Порядок и зависимости этапов

```
0 ─► 1 ─► 2 ─► 3 ─► 4 ─► 5 ─► 6 ─► 7 ─► 8
          │         ▲
          └─ 2.5 golden-тесты нужны до 4.3 (извлечение) и 5.4
```

Этапы 1 и 2 независимы по коду и могут идти параллельно после 0; этап 3 зависит от 1;
этап 4 — от 2 и 3; этап 5 — от 4.

## Риски

| Риск | Вероятность | Последствие | Мера |
|---|---|---|---|
| Вендоренный код UnoCSS сильно завязан на внутренние утилиты (`symbols`, `h`, `colorResolver`) и патчи разрастаются | средняя | этап 2 растягивается | патчи только через `src/engine/patches/`; предел — если патчей больше 10 файлов, пересмотреть ADR-2 в сторону копирования исходников `src/` апстрима вместо `dist` |
| Граф модулей Vite/rolldown не даёт стабильной принадлежности общих чанков компонентам | средняя | INV-CON-5 неточен | использовать `this.getModuleInfo` + `importedIds` на этапе `generateBundle`, а не имена файлов; фикстура `overlayZ` как тест |
| Каскадные слои меняют поведение приложений с нелейерным CSS | низкая | визуальные регрессии у потребителей | `css.layers: false`; раздел в `MIGRATION.md` |
| Статический скан `'imports'` пропускает динамические импорты | средняя | компонент без CSS | guard `'error'` по умолчанию в этом режиме; явный список остаётся |
| `bench-one` v1 и granum расходятся по правилам из-за extra-rules порядка | низкая | AC-2 красный | сравнение по множеству, не по порядку; расхождение разбирать по `why-css` |
| Node-`import.meta.resolve` с условными `exports` ведёт себя иначе в Vite SSR | низкая | манифест не найден | резолвить через `createRequire(root).resolve` как fallback |
