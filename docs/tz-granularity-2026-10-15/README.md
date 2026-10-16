# ТЗ от granularity: переезд на granum 2.0 (2026-10-15)

Ядро granularity и семь спутников переехали на granum 2.0.0 (ядро 1.1.0). Переезд
прошёл: `dist` провайдеров больше не тянет granum, рецепты `tokenOverrides` и
`define` на теме-файле работают, корневой импорт компонента ловит guard. Ниже —
четыре места, где granum 2.0 ведёт себя не так, как обещает его же документация.
granularity их не обходит и ждёт ответа: «чиним» или «правильно вот так».

Скрипты в `repro/` запускаются из корня монорепо granularity (там стоят granum
2.0.0, движок и собранное ядро) — см. шапку каждого раздела.

## ТЗ-1. Часть составного компонента проходит мимо guard

**Класс: тихо неверный результат.** Компонент, которого нет в селекции, импортом
части проходит в сборку без своего CSS.

- **Документация** (`usage-in-apps.md`, `js.guard`): «импорт компонента вне
  селекции: ошибка». Guard в `resolveId` должен поймать любой подпуть компонента
  провайдера, которого нет в селекции.
- **Код:** `vite/plugin.ts` → `providerKeyOf` узнаёт компонент по
  `provider.components`, а там только компоненты реестра. Части составных
  компонентов ядра (`GrListItem`, `GrTabPanel`, `GrDropdownMenuItem` — 22 штуки)
  в реестре не числятся, но у каждой есть свой подпуть в `exports`, ведущий в
  модуль родителя: `./components/GrListItem` → `dist/components/GrList/index.js`.
  Для такого спецификатора `providerKeyOf` отдаёт `undefined`, и guard молчит.
- **Воспроизведение** (`repro/guard-subcomponent.mjs`): приложение с селекцией
  `[GrButton]` импортирует `GrListItem` из `@feugene/granularity/components/GrListItem`
  — сборка проходит, `GrList` в селекцию не попал, его CSS нет; тот же импорт из
  `components/GrList` — `ComponentOutsideSelectionError`.

  ```
  components/GrListItem: сборка прошла
  components/GrList: ComponentOutsideSelectionError: Component '@feugene/granularity:GrList' is imported …
  ```

- **Вопрос.** Знать части составных компонентов: манифест несёт карту «подпуть →
  компонент-владелец» (её уже строит `collectGranumSubcomponents` в `./codegen`), или
  guard сводит подпуть к владельцу по `exports` пакета. Либо записать, что подпуть
  части guard не проверяет, и импортировать части только из подпути родителя.
- **Готово, когда:** импорт `components/GrListItem` при селекции без `GrList` —
  та же ошибка, что и `components/GrList`; либо ограничение записано в
  `usage-in-apps.md` рядом с описанием guard.

## ТЗ-2. `granumResolver` не резолвит части составных компонентов

**Класс: дыра в документированной возможности.** `<GrListItem>` в шаблоне через
резолвер granum не импортируется.

- **Документация** (`usage-in-apps.md`, «Auto-import»): «по имени компонента он
  отдаёт subpath провайдера».
- **Код:** `vite/resolver.ts` → `buildComponentIndex` строит индекс по
  `registry.components` — та же причина, что в ТЗ-1: частей там нет.
- **Воспроизведение** (`repro/resolver-subcomponents.mjs <каталог приложения>`):

  ```
  GrList               {"name":"GrList","from":"@feugene/granularity/components/GrList"}
  GrListItem           undefined
  GrTabPanel           undefined
  GrDropdownMenuItem   undefined
  ```

- **Как сделал granularity.** Его резолвер (`@feugene/unplugin-granularity` 1.1.0)
  строит индекс по `exports` установленных пакетов и ведёт часть в подпуть
  родителя (`GrListItem` → `components/GrList`): так импорт виден селекции. Это
  решение пакета, а не granum; если granum научится частям (ТЗ-1), резолвер
  granularity сможет опереться на `granumResolver`.
- **Готово, когда:** `granumResolver` резолвит части составных компонентов в подпуть,
  который видит селекция, — или документация называет ограничение.

## ТЗ-3. Регэксп в коде приложения читается как атрибут `class`

**Класс: ложная находка.** `granum report --strict` и `granum audit --strict` падают
на «классах», которых в разметке нет.

- **Документация** (CHANGELOG 2.0.0, «Класс разметки приложения без правила виден в
  `unmatched`»): берётся «класс из атрибута разметки (`class`, `className`,
  строковые литералы `:class`)»; «слова исходников в целом классами не считаются».
- **Код:** `node/appSources.ts` → `collectClassAttributes` ищет `STATIC_CLASS_RE`
  по всему тексту файла после `stripComments`. В `.ts` под него попадает регэксп
  `/class="max-w-full px-4 leading-6/`, и значение «атрибута» тянется до следующей
  двойной кавычки — через код.
- **Воспроизведение** (`repro/regex-class-attribute.mjs` + `repro/markup-check.ts`
  в `src/` приложения без своих классов):

  ```json
  [
    { "className": "&&", "sources": ["src/markup-check.ts"] },
    { "className": "leading-6/.test(source)", "sources": ["src/markup-check.ts"] },
    { "className": "source.includes('tabindex=", "sources": ["src/markup-check.ts"] }
  ]
  ```

  На витрине granularity то же даёт `src/pages/__tests__/showcasePagesSmoke.test.ts`:
  `2 without a rule` в строке сборки, без этого файла — `0`.
- **Вопрос.** Атрибуты разметки искать только в разметке: в `<template>` SFC, в
  HTML и в JSX-атрибутах; в JS/TS — по лексемам, как ищутся импорты (регэксп, шаблон
  и код — не атрибут). Либо исключить из скана тесты и записать это в описании
  `appSources`.
- **Готово, когда:** регэксп, строка и код в `.ts` не дают находок `unmatched`;
  тест на `collectClassAttributes` с регэкспом `/class="…/`.

## ТЗ-4. В Astro-приложении стили страниц не видны проверке `unmatched`

**Класс: ложная находка.** Та же проверка, что в ТЗ-3, на хосте Astro числит «без правила»
классы, у которых правило есть.

- **Документация** (CHANGELOG 2.0.0): в `unmatched` идёт класс из атрибута разметки, «которого
  нет ни у движка, ни в CSS собранного бандла».
- **Факт.** Astro по умолчанию встраивает CSS страниц и компонентов в `<style>` прямо в HTML
  (`build.inlineStylesheets: 'auto'`). Проверка видит только CSS-файлы бандла. Портал
  granularity (Astro 7, `@feugene/astro-granularity`, `appSources: { dirs: ['src'] }`) на
  ядре 1.1.0 и granum 2.0.0 пишет в строке сборки `266 without a rule`: 211 классов из
  `.astro` и 57 из `.vue` — собственные BEM-классы сайта (`catalogue__count`,
  `component__a11yCard`), у которых правило лежит во встроенном `<style>` страницы
  (`dist/components/affix.html`: `.component__a11yCard {`). В CSS-файлах `dist` из них
  нашлось 7. Стенды `@feugene/astro-granularity` на тех же версиях: `ssr` — 4 находки
  (`skip-link`, `prose`, `theme-icon-dark`, `theme-icon-light` из `<style>` в `.astro`),
  `static` и `hybrid` — 0: там те же стили уезжают CSS-файлом.
- **Вопрос.** Учитывать встроенные стили страниц (Astro, SSG-хосты), дать приложению способ
  объявить «эти классы стилизует мой CSS» — или записать, что на таких хостах проверка
  `unmatched` для классов разметки не годится, и как её выключить.
- **Готово, когда:** сборка портала не числит классы со встроенными правилами в
  `unmatched`, либо документация называет ограничение и способ его обойти.

