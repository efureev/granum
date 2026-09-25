# `apps/bench-one`

Подопытный стенд замера: тот же скелет, что у `bench-zero`, плюс плагин
granum и **ровно один компонент** — `XhPanel` из `@granum-fixtures/heavy`.
Его граф разворачивает ещё четыре (`XhAlert`, `XhButton`, `XhCard`,
`XhOverlay`).

## Раскладка ассетов

| ассет | роль | что внутри |
|---|---|---|
| `vue-*.js` | `vue` | рантайм фреймворка — из вердикта вычитается |
| `hpkg-*.js` | `pkg` | код компонентов провайдера |
| `index-*.css` | `css` | весь CSS granum: пять слоёв каскада одним файлом |
| `index-*.js` | `entry` | код приложения |

CSS не дробится на файлы ради замера: раскладку по слоям даёт
`granum-report.json`. Размеры слоёв в нём считаются по блокам `@layer` в
собранном ассете после минификации (`sizesSource: 'bundle'`); размеры эмиссии
до минификации лежат рядом в `emissionSizes`.

## Снятые цифры (gzip, до обрезки токенов)

```
роль        bench-zero   bench-one        Δ
css                  0       2 441   +2 441
entry              617         756     +139
pkg                  0       2 093   +2 093
vue             23 180      23 618     +438
всего           23 797      28 908   +5 111
без vue            617       5 290   +4 673
```

Токены в дистрибутиве: **объявлено 117, достижимо 49, мёртвый груз 68** —
те же числа, что на пресете v1 с тем же провайдером.

## Три сверки

- `expected.mjs` — фундамент приезжает целиком, невыбранные компоненты не
  приезжают вовсе; `App.vue` без единого собственного класса, иначе слой
  `utilities` перестаёт быть атрибутируемым.
- `expected-compare.mjs` + `v1-snapshot.css` — множество CSS-правил равно
  множеству правил того же стенда на пресете v1 (AC-2,
  `scripts/compare-css.mjs`). Снапшот снят с `bench-one` репозитория
  `unocss-preset-granular` 0.16.1.
- `expected-budget.mjs` — роли ассетов, классы без правила (`shadow-legacy` —
  намеренная фикстура), токены без объявления, движок не в бандле (N-5).
  Байты лежат в `hints` и гейтом не являются.

`scripts/compare-js.mjs` собирает стенд с заглушкой вместо плагина
(`GRANUM_STUB=1`, `dist-nogranum`) и сверяет JS-чанки побайтно (AC-3).

## Команды

```bash
yarn workspace @granum-apps/bench-one build
yarn workspace @granum-apps/bench-one verify
yarn sizes            # отчёт bench-one против bench-zero и bench-pruned против bench-one
yarn sizes:check      # строгая сверка всех стендов
yarn compare:css && yarn compare:js
```
