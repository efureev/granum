# Миграция с `unocss-preset-granular`

> 🇬🇧 English version: [`../en/migration.md`](../en/migration.md).

granum — преемник пресета v1 с тем же контрактом провайдера по смыслу, но
другим оркестратором: вместо `uno.config.ts` и сканирования `node_modules` —
манифест провайдера и собственный Vite-плагин. Пресет v1 продолжает работать
и не изменяется; мигрируют по одному пакету.

## Что сохраняется

- семантика контракта: `id`, две формы зависимостей, ключи селекции
  `id:Name`, post-order DFS, активный набор тем, приоритет слоёв токенов,
  `strictTokens`, `group`;
- раскладка `components/<Name>/index.js` и `groups/<g>/shared/`;
- диагностические команды и их смысл;
- рантайм тем (`createThemeController`).

## Что меняется в контракте

| v1 | granum | Почему |
|---|---|---|
| `packageBaseUrl` обязателен | не нужен: база — директория манифеста, найденного через `exports` | класс ошибок с `data:`-URL исчезает |
| `cssFiles` абсолютные URL + `cssFileAssetNames` | один относительный путь в манифесте | fallback компенсировал отсутствие манифеста |
| `styleAssetFileName` | удалено | было deprecated |
| `unocss: { rules, variants, preflights }` | `engine: { dialect, rules, variants, preflights }` | правило непортируемо: словарь, против которого оно написано, обязан быть назван |
| движок — часть пресета, настраивается `uno.config.ts` | инстанс в `engine` конфига приложения | выбор реализации принадлежит тому, кто отвечает за результат |
| `tokenDefinitionsRef` читает приложение | материализуется в манифест на сборке провайдера | считать один раз там, где данные родились |
| safelist ∩ статика не проверяется | предупреждение `safelist-redundant` | молчаливых поломок нет |
| `undeclared-dependency` по тексту, `warn` | по графу модулей бандлера, `error` | точность |
| `layer: 'granular'` с порядком −50 | каскадные слои `granum.*` | порядок объяснён именами |
| ключ токена с `--` → `----x` | `InvalidTokenKeyError` | молчаливых поломок нет |
| `scan.*`, `content.filesystem` | нет: `node_modules` не сканируется | манифест |

## Провайдер

1. Импорты: `@feugene/unocss-preset-granular/contract` →
   `@feugene/granum/contract`; `defineGranularComponent` →
   `defineGranumComponent`; `defineGranularProvider` → `defineGranumProvider`.
2. Убрать `packageBaseUrl`, `cssFileAssetNames`, `styleAssetFileName`;
   `unocss` переименовать в `engine` и добавить в него `dialect` — имя словаря,
   против которого написаны правила; файлы темы объявлять путями относительно
   `dist` (`theme/base.css`), исходники держать в `src/theme/`.
3. В `vite.config.ts` заменить `granularChunkFileNames`,
   `granularAssetFileNames`, `granularCssAssetsPlugin` и ручные entry одним
   `granumProvider({ provider, engine: windEngine() })`.
4. Добавить `codegenTargets.manifestExport()` в codegen, чтобы
   `package.json#exports` содержал `./granum.manifest.json`.
5. `vite build`, затем `granum doctor --strict` в приложении-потребителе.

```diff
- import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'
+ import { defineGranumComponent } from '@feugene/granum/contract'

- export const xhCardConfig = defineGranularComponent(import.meta.url, {
+ export const xhCardConfig = defineGranumComponent(import.meta.url, {
    name: 'XhCard',
-   cssFiles: ['./styles.css'],
-   cssFileAssetNames: ['XhCard.css'],
+   cssFiles: ['./styles.css'],
  })
```

## Приложение

1. Удалить `uno.config.ts`, зависимости `unocss` и `@unocss/*`, импорты
   `virtual:uno.css` и `virtual:uno:granular.css`; поставить движок:
   `yarn add -D @feugene/granum-engine-wind`.
2. Создать `granum.config.ts` с обязательным `engine: windEngine()`,
   `providers`, `components`, `themes`, `appSources`; добавить `granum(config)`
   в `vite.config.ts`. Правила, которые приложение писало себе в `uno.config.ts`,
   переезжают в фабрику движка: `windEngine({ rules: […] })`.
3. Заменить два импорта CSS одним `import 'virtual:granum.css'`.
4. Собрать и проверить `dist/granum-report.json`: `classes.unmatched` должен
   быть пуст или объяснён; `tokens.undefined` — пуст.

```diff
- import UnoCSS from 'unocss/vite'
+ import { granum } from '@feugene/granum/vite'
+ import config from './granum.config.ts'

  export default defineConfig({
-   plugins: [vue(), UnoCSS()],
+   plugins: [vue(), granum(config)],
  })
```

Опции пресета v1 переезжают почти один в один: `providers`, `components`,
`themes.names/define/tokenOverrides/strictTokens`, `pruneTokens` — те же
имена; `pruneTokens.appSources` стал `appSources` верхнего уровня, потому что
теперь он питает и извлечение классов приложения.

Одного соответствия в v1 нет вовсе: движка. В пресете он был частью пакета и
настраивался `uno.config.ts`; в granum его выбирает приложение и передаёт
инстансом, а пакеты записывают в манифест диалект и отпечаток словаря той
реализации, которой собраны. Что это меняет на практике — в
[движках и диалектах](./engines-and-dialects.md).

## Сброс стилей — в слой

Самая тихая ловушка переезда. У пресета v1 «слои» UnoCSS — порядок вывода, и
спор между сбросом и утилитой решала специфичность: `.text-[…]` сильнее
`button`. У granum это настоящие каскадные слои, и правило меняется на
противоположное: любой нелейерный CSS бьёт любой `@layer`.

Значит, импорт вроде `import '@unocss/reset/tailwind-compat.css'` после переезда
начинает перебивать утилиты и CSS компонентов. Перенесите его в слой:

```css
/* src/styles/reset.css — импортируется ПЕРЕД virtual:granum.css */
@import '@unocss/reset/tailwind-compat.css' layer(reset);
```

Подробнее — в [«Как подключить в приложении»](./usage-in-apps.md).

## Проверка эквивалентности

`yarn compare:css` в этом репозитории сверяет CSS стенда `bench-one` на
granum со снапшотом того же стенда на пресете v1: множества правил совпадают.
Тот же приём годится для своего приложения — снять CSS до миграции, собрать
после и сравнить `scripts/compare-css.mjs`.
