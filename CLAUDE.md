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

## Команды

| Команда | Что делает |
|---|---|
| `yarn lint` / `yarn typecheck` / `yarn test` | пакет |
| `yarn test:scripts` | чистые функции `scripts/` |
| `yarn build` | сборка пакета в `packages/granum/dist` |
| `yarn check:boundary` | зависимости и `node:`-импорты в собранных браузерных entry |
| `yarn build:all` | пакет → фикстуры → приложения (пока фикстур нет — пропуск) |
| `yarn test:all` | всё, что гоняет CI |

## Общение

Отвечай по-русски. Комментарии в коде и JSDoc — по-русски; сообщения ошибок,
идентификаторы и `description` в `package.json` — по-английски.
