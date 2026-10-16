# ТЗ от granularity: части составных компонентов и проверка `unmatched` (granum 2.0.0)

## Контекст

Ядро granularity и семь его спутников переехали на granum 2.0.0 (ядро 1.1.0, 2026-10-16).
Переезд прошёл: `dist` провайдеров больше не тянет granum, рецепты `tokenOverrides` и `define`
на теме-файле работают, корневой импорт компонента ловит `ComponentRootImportError`. На
трёх приложениях granularity — витрине ядра, портале (Astro 7, статика) и стендах
`@feugene/astro-granularity` (`static`, `ssr`, `hybrid`) — нашлись места, где granum 2.0.0
ведёт себя не так, как обещает его собственная документация. Ниже их четыре, по двум темам:

- **части составных компонентов** (ТЗ-1, ТЗ-1б, ТЗ-2): у ядра granularity 22 таких части
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
✗ воспроизводится  ТЗ-1: подпуть части проходит мимо guard
  сейчас: components/XcListItem при селекции [XcButton]: сборка прошла, CSS XcList нет; components/XcList — ComponentOutsideSelectionError; с XcList в селекции CSS есть
✗ воспроизводится  ТЗ-1б: селекция из импортов не видит части
  сейчас: components: 'imports', импорт components/XcListItem: селекция [], CSS XcList нет
✗ воспроизводится  ТЗ-2: granumResolver не резолвит части
  сейчас: XcList → @granum-fixtures/composite/components/XcList; XcListItem → undefined
✗ воспроизводится  ТЗ-5: CSS приложения через ?raw не виден проверке unmatched
  сейчас: unmatched: ["raw-note"] — правило .raw-note в src/raw.css, на страницу едет строкой

4 из 4 воспроизводятся.
```

**Общий критерий готовности:** `repro:expect` зелёный, у каждого исправления есть свой
тест в `packages/granum`, а `repro:expect` становится `verify` стенда.

## Сводка

| ID | Что | Класс | Чем бьёт по granularity |
|---|---|---|---|
| ТЗ-1 | подпуть части проходит мимо guard | тихо неверный результат | селекция без `GrList` собирается без его CSS — список приезжает голым |
| ТЗ-1б | селекция из импортов не видит части | тихо неверный результат | в `components: 'imports'` то же самое, только без всякого предупреждения |
| ТЗ-2 | `granumResolver` не знает частей | дыра в возможности | авто-импорт `<GrListItem>` через granum не работает; granularity держит свой резолвер |
| ТЗ-5 | CSS приложения строкой (`?raw`) не виден | вопрос | на портале 215 ложных находок из 267 |

---

## ТЗ-1. Подпуть части проходит мимо guard

**Документация** (`usage-in-apps.md`, `js.guard`): «импорт компонента вне селекции: ошибка».

**Пример.** Селекция `[XcButton]`, приложение импортирует часть:

```ts
import { XcListItem } from '@granum-fixtures/composite/components/XcListItem'
```

Сборка проходит. `XcListItem` — модуль `XcList`, но `XcList` в селекции нет, и его CSS
(`.xc-list`, утилита `divide-y`) в сборку не попадает. Тот же импорт через
`components/XcList` даёт `ComponentOutsideSelectionError`. С `XcList` в селекции CSS на месте.

**Причина.** `vite/plugin.ts`, `providerKeyOf`: спецификатор `<pkg>/components/<Name>`
принимается, только если `<Name>` есть в `provider.components`. Частей там нет, функция
возвращает `undefined`, и `resolveId` не проверяет импорт вовсе. Карту «часть → владелец»
granum строит (`codegen/subcomponents.ts`, `collectGranumSubcomponents`), но кладёт её только в
алиасы `package.json#exports` (`codegen/targets.ts`). В манифест она не попадает, и сборка
приложения о частях не знает.

**Что хотим увидеть.**

- Импорт `components/XcListItem` при селекции без `XcList` — `ComponentOutsideSelectionError`
  на `XcList`. В тексте ошибки названы и часть, и владелец, например:
  `Component '@granum-fixtures/composite:XcList' is imported from 'src/main.ts' through its part 'XcListItem', but is not part of the granum selection […]`.
- Владельца можно определить без правки контракта: подпуть части разрешается через
  `exports` провайдера в тот же файл, что `entry` владельца в манифесте
  (`components/XcList/index.js`). Если granum предпочтёт явное поле манифеста
  (`subcomponents: { XcListItem: 'XcList' }`), granularity пересоберёт провайдеры. Выбор за
  granum, важен результат.
- Тест на `providerKeyOf` или его замену с подпутём части.
- Абзац в `usage-in-apps.md` (en/ru) о частях: guard сводит их к владельцу.

**Как поступит granularity.** Ничего не меняет у себя. Импорты частей у ядра уже ведут в
подпуть родителя — ровно потому, что guard их не видит; после исправления это станет
необязательным.

**Если чинить не будете:** записать в `usage-in-apps.md`, что подпуть части guard не
проверяет и части нужно импортировать из подпути владельца.

## ТЗ-1б. Селекция из импортов не видит части

**Пример.** `components: 'imports'`, приложение импортирует только
`components/XcListItem`. Селекция пустая, CSS `XcList` нет. Импорт `components/XcList` даёт
селекцию `[XcList]` и CSS.

**Причина** та же, что у ТЗ-1. `node/appSources.ts` честно находит импорт
`@granum-fixtures/composite:XcListItem` (`COMPONENT_IMPORT_RE`), но сверка с графом его
отбрасывает: такого компонента нет.

**Что хотим увидеть:** импорт части добавляет в селекцию владельца — то же правило
сведения, что в ТЗ-1, в одном месте для guard, селекции и резолвера.

## ТЗ-2. `granumResolver` не резолвит части составных компонентов

**Документация** (`usage-in-apps.md`, «Auto-import»): «по имени компонента он отдаёт subpath
провайдера».

**Пример:** `resolve('XcList')` → `@granum-fixtures/composite/components/XcList`,
`resolve('XcListItem')` → `undefined`. В шаблоне `<XcListItem>` не импортируется.

**Причина.** `vite/resolver.ts`, `buildComponentIndex` строит индекс по
`registry.components` — частей там нет.

**Что хотим увидеть.**

- `resolve('XcListItem')` → `{ name: 'XcListItem', from: '@granum-fixtures/composite/components/XcListItem' }`.
  Подпуть части годится как есть: guard и селекция сводят его к владельцу (ТЗ-1, ТЗ-1б).
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
