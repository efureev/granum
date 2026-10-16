# ТЗ от granularity: части составных компонентов и проверка `unmatched` (granum 2.0.0)

## Контекст

Ядро granularity и семь его спутников переехали на granum 2.0.0 (ядро 1.1.0, 2026-10-16).
Переезд прошёл: `dist` провайдеров больше не тянет granum, рецепты `tokenOverrides` и `define`
на теме-файле работают, корневой импорт компонента ловит `ComponentRootImportError`. На
трёх приложениях granularity — витрине ядра, портале (Astro 7, статика) и стендах
`@feugene/astro-granularity` (`static`, `ssr`, `hybrid`) — нашлись места, где granum 2.0.0
ведёт себя не так, как обещает его собственная документация. Ниже их два, по двум темам:

- **части составных компонентов** (ТЗ-2): у ядра granularity 22 таких части
  (`GrListItem`, `GrTabPanel`, `GrDropdownMenuItem`…); у каждой свой подпуть в `exports`,
  ведущий в модуль родителя, — его заводит сам `granum codegen --subcomponents`;
- **проверка `unmatched`** (ТЗ-5): ложные находки «класс без правила». Пока они
  есть, `granum report --strict` и `granum audit --strict` в CI включить нельзя, а настоящие
  находки тонут среди ложных: на портале их 267, из них 52 настоящих.

granularity эти места не обходит и ждёт по каждому пункту одного из двух ответов:
исправление в 2.0.x или запись ограничения в документации вместе со способом жить с ним.
Чего ждём по каждому пункту, записано в разделе «Что хотим увидеть».

## Как воспроизвести

Все пункты воспроизводятся в этом репозитории на фикстурах granum, без пакетов granularity:

```bash
yarn build
yarn workspace @granum-fixtures/composite build
yarn workspace @granum-apps/tz-granularity repro
```

- [`fixtures/composite-package`](../../fixtures/composite-package) — провайдер
  `@granum-fixtures/composite` с составным `XcList`, его частью `XcListItem` и простым
  `XcButton`. `exports` порождены `granum codegen --subcomponents`, поэтому
  `./components/XcListItem` ведёт в `dist/components/XcList/index.js` — так же, как у ядра
  granularity. Это первая фикстура с подпутями частей: у `XNested` фикстуры `simple` части
  есть, но без подпутей.
- [`apps/tz-granularity`](../../apps/tz-granularity) — стенд со случаями. `repro` печатает
  «сейчас / ждём» по каждому пункту, `repro:expect` завершается кодом 1, пока хоть один пункт
  воспроизводится. `build` и `verify` у стенда нет, и CI его пропускает.

Вывод на текущем коде (строки «ждём» опущены):

```
✗ воспроизводится  ТЗ-2: granumResolver не резолвит части
  сейчас: XcList → @granum-fixtures/composite/components/XcList; XcListItem → undefined
✗ воспроизводится  ТЗ-5: CSS приложения через ?raw не виден проверке unmatched
  сейчас: unmatched: ["raw-note"] — правило .raw-note в src/raw.css, на страницу едет строкой

2 из 2 воспроизводятся.
```

**Общий критерий готовности:** `repro:expect` зелёный, у каждого исправления есть свой
тест в `packages/granum`, а `repro:expect` становится `verify` стенда.

## Сводка

| ID | Что | Класс | Чем бьёт по granularity |
|---|---|---|---|
| ТЗ-2 | `granumResolver` не знает частей | дыра в возможности | авто-импорт `<GrListItem>` через granum не работает; granularity держит свой резолвер |
| ТЗ-5 | CSS приложения строкой (`?raw`) не виден | вопрос | на портале 215 ложных находок из 267 |

---

## ТЗ-2. `granumResolver` не резолвит части составных компонентов

**Документация** (`usage-in-apps.md`, «Auto-import»): «по имени компонента он отдаёт subpath
провайдера».

**Пример:** `resolve('XcList')` → `@granum-fixtures/composite/components/XcList`,
`resolve('XcListItem')` → `undefined`. В шаблоне `<XcListItem>` не импортируется.

**Причина.** `vite/resolver.ts`, `buildComponentIndex` строит индекс по
`registry.components` — частей там нет.

**Что хотим увидеть.**

- `resolve('XcListItem')` → `{ name: 'XcListItem', from: '@granum-fixtures/composite/components/XcListItem' }`.
  Подпуть части годится как есть: guard и селекция сводят его к владельцу.
- Части есть в `names()`.
- Правило неоднозначности распространяется и на них: часть с тем же именем у двух
  провайдеров не резолвится.

**Как поступит granularity.** `@feugene/unplugin-granularity` 1.1.0 сейчас строит свой индекс по
`exports` установленных пакетов и ведёт часть в подпуть родителя. После исправления он
сможет опереться на `granumResolver`.

## ТЗ-5. CSS приложения, подключённый строкой (`?raw`), не виден проверке

**Пример.** Лист приложения импортируется строкой и вставляется в `<style>`:

```ts
import css from './raw.css?raw'
const style = document.createElement('style')
style.textContent = css
document.head.append(style)
```

`raw-note` из `index.html` — в `unmatched`, хотя правило `.raw-note` лежит в `src/raw.css`
внутри `appSources`.

**Где встретилось.** Портал granularity так подключает три листа
(`catalogue-inline.css`, `component-inline.css`, `docs-inline.css`): строкой в
`<style set:html>`: стили, нужные одной странице из шестисот, не должны ехать в общий лист
сайта с его бюджетом. Из 267 находок портала 215 —
классы с правилом в этих листах. Остальные 52 — классы без правила нигде, это настоящие
находки, и портал разберёт их сам.

**Причина.** По определению из CHANGELOG вердикт формально верен: такого CSS нет среди
CSS-ассетов бандла, для бандлера это строка в JS. Но `.css`-файлы из `appSources` granum уже
читает — ради токенов (`scanAppSources`, `scanTokenConsumption`), — а для классов не смотрит.

**Что хотим увидеть** — один из двух ответов:

1. **(Предпочтительно.)** Класс, объявленный в `.css`-файле из `appSources`, не идёт в
   `unmatched`: правило у приложения есть, просто приходит не ассетом. Тест на случай `?raw`.
2. Или ограничение записано в документации `report` и `appSources` вместе со способом его
   снять. Например, опция с дополнительными источниками объявленных классов или список
   исключений.

**Как поступит granularity.** При варианте 1 у портала остаются 52 настоящие находки, он их
исправит и включит `report --strict`. При варианте 2 портал подключит опцию.
