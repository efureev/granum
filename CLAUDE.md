# granum

Yarn 1 workspaces-монорепо вокруг `@feugene/granum` — конвейера сборки гранулярных
UI-пакетов (компоненты, стили, токены, темы) от манифеста провайдера до бандла
приложения. Преемник `@feugene/unocss-preset-granular`; тот репозиторий не изменяется.

## Жёсткие правила

**Сначала ТЗ.** `docs/spec.md` — требования с идентификаторами, `docs/invariants.md` —
инварианты `INV-*`, `docs/decisions.md` — закрытые решения, `docs/plan.md` — этапы.
Любая задача ссылается на требование или инвариант; решение из `decisions.md`
не переоткрывается без правки файла.

**Пакетный менеджер — Yarn 1** (`yarn.lock`). `npm install`/`pnpm` ломают симлинки
воркспейсов.

**Границы точек входа** — таблица ТЗ §4.2. `.`, `./contract`, `./engine`, `./runtime`
без `node:` и без внешних зависимостей; `yarn check:boundary` проверяет это на `dist`.

**Зависимостей у пакета нет**, peer — только `vite`. Тест `packageJson.test.ts` и
`check:boundary` красные при любом отклонении.

**Ничего из `unocss`/`@unocss/*` в рантайме.** Движок вендорится на этапе 2 в
`src/engine/vendor/`; `unocss` допустим только в devDependencies для golden-тестов.

**`docs/en` и `docs/ru` — зеркала**, как и корневые `README.md`/`README.ru.md`;
`yarn check:docs` после любой правки документации.

**Нормативную часть правят в `docs/spec.md`, а не в пакетном `SPEC.md`.** Второй —
порождаемая копия (`yarn generate:spec`), которая уезжает в опубликованный пакет;
правка руками теряется, а расхождение ловит `yarn check:spec`.

## Команды

| Команда | Что делает |
|---|---|
| `yarn lint` / `yarn typecheck` / `yarn test` | пакет |
| `yarn test:scripts` | чистые функции `scripts/` |
| `yarn build` | сборка пакета в `packages/granum/dist` |
| `yarn check:boundary` | зависимости и `node:`-импорты в собранных браузерных entry |
| `yarn check:spec` | `packages/granum/docs/SPEC.md` совпадает с нормативными разделами `docs/spec.md` (`yarn generate:spec` перезаписывает) |
| `yarn build:all` | пакет → фикстуры → приложения |
| `yarn verify:fixtures` | round-trip и сверка манифестов собранных фикстур с `expected-manifest.mjs` |
| `yarn check:determinism` | повторная сборка фикстур: манифест побайтно стабилен |
| `yarn e2e` | браузерные проверки каскада и HMR на dev-сервере `apps/app-1` (нужен `yarn playwright install chromium`) |
| `yarn test:all` | всё, что гоняет CI, кроме `e2e`: тот тянет браузер и живёт своей джобой |

## Общение

Отвечай по-русски. Комментарии в коде и JSDoc — по-русски; сообщения ошибок,
идентификаторы и `description` в `package.json` — по-английски.
