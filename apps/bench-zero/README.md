# `apps/bench-zero`

Нулевая отметка замера: приложение на голом Vue **без единого импорта из
`@granum-fixtures/*` и без granum**.

## Зачем

Чтобы фраза «компонент стоит N килобайт» имела знаменатель. `dist` этого
стенда — цена пустого Vue-приложения с той же сборочной обвязкой, что у
`bench-one`: тот же `vue`-чанк, то же расщепление. Разница между
дистрибутивами и есть цена подключения библиотеки.

## Что держит стенд нулевым

В `dependencies` ровно `vue`. `expected.mjs` состоит из одних `absent`: стенд
существует ради отсутствия. Как только сюда просочится токен провайдера
(`--xh-`), preflight движка (`--un-rotate`), слой `@layer granum` или
структурный класс (`.xh-`), знаменатель перестанет быть нулём — молча, потому
что сборка от этого не краснеет. `expected-budget.mjs` проверяет состав ролей:
`vue`, `entry` — и ничего сверх, и отсутствие `granum-report.json`.

## Команды

```bash
yarn workspace @granum-apps/bench-zero build
yarn workspace @granum-apps/bench-zero verify
node scripts/report-css-budget.mjs --stand bench-zero --strict
```
