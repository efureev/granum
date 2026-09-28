# Использование в приложениях

> 🇬🇧 English version: [`../en/usage-in-apps.md`](../en/usage-in-apps.md).

Приложение описывает, **какие** компоненты и темы ему нужны, в
`granum.config.ts`; плагин `granum()` строит из манифестов провайдеров одну
резолюцию и кормит ею три канала: CSS, JS и темы.

## Конфиг

```ts
import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@acme/ui', '@acme/base'],
  components: [{ provider: '@acme/ui', names: ['XhPanel'] }, '@acme/base:XBox'],
  themes: { names: ['light', 'dark'], tokenOverrides: { light: { 'xh-accent': '#0a7' } }, strictTokens: true },
  appSources: { dirs: ['src'] },
  css: { layers: true, layerPrefix: 'granum' },
  js: { virtualComponents: true, guard: 'error' },
  pruneTokens: { mode: 'off' },
  report: { file: 'granum-report.json' },
})
```

| Поле | Значение по умолчанию | Смысл |
|---|---|---|
| `engine` | — (обязательно) | инстанс движка утилит: `windEngine()` из `@feugene/granum-engine-wind` или свой; строка `'builtin'` и объект опций не принимаются |
| `providers` | — | имена пакетов (манифест ищется через `exports["./granum.manifest.json"]`) или объекты контракта; объект с `baseUrl` на существующий `dist` сканируется приложением само (медленный путь, `provider-scanned`) |
| `components` | `'all'` | список ключей `id:Name` / `{ provider, names }` либо `'imports'` — по импортам в `appSources` |
| `themes.names` | по `define` → `defaultThemes` провайдеров → `['light']` | активный набор тем |
| `themes.define` | — | темы приложения: `{ extends, tokens, tokensRef, label, colorScheme }` |
| `themes.tokenOverrides` | — | значения поверх всех слоёв провайдеров |
| `themes.strictTokens` | `false` | override токена, который не объявлен ни одним слоем, отбрасывается |
| `appSources` | — | директории, из которых извлекаются классы и потребление токенов приложения |
| `css.layers` | `true` | обёртки `@layer`; `false` — плоская конкатенация в том же порядке |
| `js.guard` | `'error'` | импорт компонента вне селекции: ошибка, предупреждение или ничего |
| `js.dts` | — | куда писать объявления для `virtual:granum/components`, например `src/granum.d.ts` |
| `pruneTokens.mode` | `'off'` | `'report'` — план в отчёте, `'on'` — обрезка слоёв `tokens` и `themes` |
| `report.file` | `'granum-report.json'` | отчёт сборки в `outDir`; `false` — не писать |
| `report.brotli` | `false` | считать ли размеры слоёв в brotli: качество 11 — 151 мс на 222 kB против 2 мс у gzip |

Форма конфига проверяется при загрузке: `InvalidConfigError` называет путь до
поля. Один и тот же объект конфига читают CLI и плагин, поэтому `doctor`
видит ровно ту селекцию, что уйдёт в сборку.

## Селекция

Список компонентов замыкается транзитивно по `dependencies` из манифестов:
зависимости встают раньше зависящих (post-order DFS), и этот порядок
нормативен для CSS и токенов. `components: 'imports'` вычисляет стартовый
список по импортам вида `@acme/ui/components/XhPanel` и по PascalCase-тегам в
`appSources`.

Рекомендуемый режим — явный список: он держит селекцию в одном месте, где её
видно на ревью. `'imports'` уместен там, где набор компонентов часто меняется,
но помните про его границу: компонент, отрисованный по вычисленному имени
(`<component :is="name">`), скан не находит, и его CSS в сборку не попадёт.

Guard в `resolveId` ловит импорт компонента, которого нет в селекции, и
называет импортёра:

```
[granum] ComponentOutsideSelectionError: '@acme/ui:XhTable' is imported by
src/App.vue but is not part of the selection [@acme/ui:XhPanel, …]
```

## Движок и классы пакетов

`engine` в конфиге — инстанс движка утилит: своего у granum нет, выбор делает
приложение. Правила приложения передаются фабрике движка
(`windEngine({ rules: […] })`), у конфига поля для правил нет.

Списку классов в манифесте granum верит только при равенстве отпечатков
словаря: в блоке `engine` манифеста записан отпечаток той реализации, которая
список отфильтровала. При различии классы пакета пересчитываются движком
приложения из файлов манифеста, и разница называется — `gained` (сборка пакета
потеряла, приложение вернуло) и `lost` (правила нет у приложения; класс
остаётся во входе движка и виден в `unmatched`). Модуль правил пакета грузится
по равенству диалектов, а не отпечатков; полностью таблица решений — в
[движках и диалектах](./engines-and-dialects.md).

## CSS-канал

```ts
import 'virtual:granum.css'
```

Модуль содержит объявление порядка и пять слоёв:

```css
@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;
@layer granum.tokens { … }      /* theme.tokensCss провайдеров, структурные токены :root */
@layer granum.base { … }        /* preflight движка, затем theme.baseCss */
@layer granum.themes { … }      /* блоки токенов активных тем, файлы тем */
@layer granum.components { … }  /* cssFiles и styles.css компонентов селекции */
@layer granum.utilities { … }   /* утилиты движка */
```

Вход движка — объединение статических классов компонентов селекции (из
манифестов), их safelist и классов, извлечённых из `appSources`. Один слой
отдельно: `virtual:granum/layers/utilities.css` — со своей обёрткой `@layer`;
конкатенация слоёв равна целому. Нелейерный CSS приложения перебивает всё, что
внутри слоёв, — так и задумано: утилита в шаблоне приложения побеждает базовый
стиль компонента.

### Отдельный ассет на слой: `css.split`

Один файл жмётся лучше, но инвалидируется целиком: правка разметки сбрасывает
кеш токенов и тем, которые не менялись.

```ts
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@acme/ui'],
  appSources: { dirs: ['src'] },
  css: { split: true },
})
```

Каждый непустой слой уезжает своим ассетом с собственным хешем, а `<link>` на
них проставляются в HTML в порядке слоёв — порядок ссылок и есть порядок
каскада. Правка разметки после этого меняет один ассет из пяти; остальные
четыре браузер берёт из кеша. Стенд `apps/bench-split` проверяет именно это:
две сборки и сравнение имён.

Границы опции: она действует только на сборке приложения и только там, где есть
HTML-точка входа — ссылки проставляются в неё, и без HTML плагин скажет об этом
предупреждением. Серверная сборка HTML не порождает, а в dev хешированных
ассетов нет вовсе, и CSS там по-прежнему приходит одним модулем. Платить
приходится суммарным весом: пять файлов жмутся хуже одного, зато перекачивается
один слой, а не весь CSS.

## JS-канал

```ts
import { XhPanel } from 'virtual:granum/components'
```

Виртуальный модуль реэкспортирует компоненты селекции из их subpath и не
имеет побочных эффектов: tree-shaking вырезает невостребованное. Обычные
импорты `@acme/ui/components/XhPanel` тоже работают; плагин не переписывает
код провайдера и не меняет раскладку чанков.

Важно, что каналы разные: JS идёт по импортам, CSS — по селекции.
Компонент, который есть в селекции, но не импортирован, в бандл не попадёт, а
его CSS попадёт. Чтобы ушло и то и другое, сужайте селекцию, а не импорты.

Типы. Амбиентные объявления виртуальных модулей поставляет сам пакет — ссылка
один раз в любом `.d.ts` проекта:

```ts
/// <reference types="@feugene/granum/client" />
```

Имён компонентов там нет и быть не может: они зависят от селекции
приложения, а не от пакета, и импорт оттуда типизирован как `any`. Точные
объявления порождает плагин — как `components.d.ts` у авто-импорта:

```ts
// granum.config.ts
js: { dts: 'src/granum.d.ts' }
```

Файл переписывается только при смене селекции и его место — в гите:

```ts
declare module 'virtual:granum/components' {
  export { XhPanel } from '@acme/ui/components/XhPanel'
}
```

## Auto-import

Для `unplugin-vue-components` и совместимых инструментов есть резолвер: по
имени компонента он отдаёт subpath провайдера, неизвестное или неоднозначное
имя (два провайдера с одним `Name`) не резолвит.

```ts
import { granum, granumResolver } from '@feugene/granum/vite'
import Components from 'unplugin-vue-components/vite'

export default defineConfig({
  plugins: [vue(), granum(config), Components({ resolvers: [granumResolver(config, { prefix: 'Xh' })] })],
})
```

В режиме `components: 'imports'` селекция пополняется не резолвером, а
сканом PascalCase-тегов в `appSources`: `<XhPanel>` без импорта попадает в
селекцию, если имя объявляет ровно один провайдер графа. Так селекция не
зависит от порядка трансформаций бандлера.

## Темы в рантайме

```ts
import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'

export const themes = createThemeController(manifest)
themes.set('dark')
```

Манифест тем — имена, селекторы и режим активации (`data-theme`, класс,
`:root`), выведенные из той же резолюции. Подробно —
[Темы и токены](./themes-and-tokens.md).

## Dev-режим

Правка исходника приложения перегенерирует слой `utilities`; изменение
манифеста провайдера (монорепо, `vite build --watch` у провайдера)
инвалидирует резолюцию целиком. Ошибки резолюции показываются оверлеем Vite.

## Отчёт сборки

`dist/granum-report.json` — селекция, темы и их источник, классы без правила
с источниками, safelist-записи, покрытые статикой, план обрезки, токены без
объявления, размеры слоёв raw/gzip/brotli по собранному ассету после
минификации (`sizesSource: 'bundle'`) и по эмиссии (`emissionSizes`).
Прочитать его: `granum report`.

Времени сборки в отчёте нет и не будет: он обязан быть побайтно стабильным
между сборками, а время стабильным не бывает. Оно печатается строкой в
лог сборки:

```
[granum] time 80 ms (prepare 3, emit 38, report 41)
```

`prepare` — манифесты, пересчёт классов, скан исходников и резолюция;
`emit` — генератор утилит и сборка слоёв; `report` — размеры слоёв со сжатием
и запись файла. Всё остальное в сборке — vue, бандлер, минификация — не granum.
Большой `prepare` почти всегда значит пересчёт классов: отпечаток словаря
пакета разошёлся с движком приложения, и классы читаются из файлов пакета
(`granum doctor` назовёт причину).
