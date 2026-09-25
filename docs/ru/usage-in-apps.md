# Использование в приложениях

> 🇬🇧 English version: [`../en/usage-in-apps.md`](../en/usage-in-apps.md).

Приложение описывает, **какие** компоненты и темы ему нужны, в
`granum.config.ts`; плагин `granum()` строит из манифестов провайдеров одну
резолюцию и кормит ею три канала: CSS, JS и темы.

## Конфиг

```ts
import { defineGranumConfig } from '@feugene/granum/vite'

export default defineGranumConfig({
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
| `providers` | — | имена пакетов (манифест ищется через `exports["./granum.manifest.json"]`) или объекты контракта |
| `components` | `'all'` | список ключей `id:Name` / `{ provider, names }` либо `'imports'` — по импортам в `appSources` |
| `themes.names` | по `define` → `defaultThemes` провайдеров → `['light']` | активный набор тем |
| `themes.define` | — | темы приложения: `{ extends, tokens, tokensRef, label, colorScheme }` |
| `themes.tokenOverrides` | — | значения поверх всех слоёв провайдеров |
| `themes.strictTokens` | `false` | override токена, который не объявлен ни одним слоем, отбрасывается |
| `appSources` | — | директории, из которых извлекаются классы и потребление токенов приложения |
| `css.layers` | `true` | обёртки `@layer`; `false` — плоская конкатенация в том же порядке |
| `js.guard` | `'error'` | импорт компонента вне селекции: ошибка, предупреждение или ничего |
| `pruneTokens.mode` | `'off'` | `'report'` — план в отчёте, `'on'` — обрезка слоёв `tokens` и `themes` |
| `report.file` | `'granum-report.json'` | отчёт сборки в `outDir`; `false` — не писать |

Форма конфига проверяется при загрузке: `InvalidConfigError` называет путь до
поля. Один и тот же объект конфига читают CLI и плагин, поэтому `doctor`
видит ровно ту селекцию, что уйдёт в сборку.

## Селекция

Список компонентов замыкается транзитивно по `dependencies` из манифестов:
зависимости встают раньше зависящих (post-order DFS), и этот порядок
нормативен для CSS и токенов. `components: 'imports'` вычисляет стартовый
список по импортам вида `@acme/ui/components/XhPanel` в `appSources`.

Guard в `resolveId` ловит импорт компонента, которого нет в селекции, и
называет импортёра:

```
[granum] ComponentOutsideSelectionError: '@acme/ui:XhTable' is imported by
src/App.vue but is not part of the selection [@acme/ui:XhPanel, …]
```

## CSS-канал

```ts
import 'virtual:granum.css'
```

Модуль содержит объявление порядка и пять слоёв:

```css
@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;
@layer granum.tokens { … }      /* theme.tokensCss провайдеров, структурные токены :root */
@layer granum.base { … }        /* theme.baseCss */
@layer granum.themes { … }      /* блоки токенов активных тем, файлы тем */
@layer granum.components { … }  /* cssFiles и styles.css компонентов селекции */
@layer granum.utilities { … }   /* вывод движка: preflight и утилиты */
```

Вход движка — объединение статических классов компонентов селекции (из
манифестов), их safelist и классов, извлечённых из `appSources`. Один слой
отдельно: `virtual:granum/layers/utilities.css`; конкатенация слоёв равна
целому. Нелейерный CSS приложения перебивает всё, что внутри слоёв, — так и
задумано: утилита в шаблоне приложения побеждает базовый стиль компонента.

## JS-канал

```ts
import { XhPanel } from 'virtual:granum/components'
```

Виртуальный модуль реэкспортирует компоненты селекции из их subpath и не
имеет побочных эффектов: tree-shaking вырезает невостребованное. Обычные
импорты `@acme/ui/components/XhPanel` тоже работают; плагин не переписывает
код провайдера и не меняет раскладку чанков.

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
объявления, размеры слоёв raw/gzip/brotli. Прочитать его: `granum report`.
