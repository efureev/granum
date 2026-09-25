# Разработка провайдеров

> 🇬🇧 English version: [`../en/authoring-providers.md`](../en/authoring-providers.md).

Провайдер — npm-пакет компонентов, который публикует `dist` в раскладке
granum и `granum.manifest.json`. Приложение читает только манифест и файлы,
на которые он ссылается; JS провайдера ради резолюции не исполняется.

## Раскладка пакета

```
src/
  components/<Name>/config.ts      дескриптор (defineGranumComponent)
  components/<Name>/index.ts       entry компонента
  components/<Name>/<Name>.vue     код и <style>
  components/<Name>/styles.css     необязательный CSS (cssFiles)
  theme/{tokens,base,light,dark}.css
  granum-provider/index.ts         defineGranumProvider
  index.ts                         barrel
dist/
  components/<Name>/index.js       entry в раскладке
  components/<Name>/chunks/*.js    SFC-чанки компонента
  components/<Name>/styles.css     CSS компонента
  groups/<g>/shared/*.js           общие чанки группы
  chunks/*.js                      общие чанки вне групп
  theme/*.css                      фундамент (копия src/theme)
  granum.manifest.json
```

Файлы темы объявляются путями относительно `dist` (`theme/base.css`), а
исходники лежат зеркально в `src/theme/`: плагин копирует их сам.

## Дескриптор компонента

```ts
import { defineGranumComponent } from '@feugene/granum/contract'

export const xhButtonConfig = defineGranumComponent(import.meta.url, {
  name: 'XhButton',
  dependencies: ['XhIcon', '@acme/base:XBox'],
  safelist: ['p-2', 'p-3', 'bg-[var(--xh-btn-bg)]'],
  dynamicTokens: ['xh-z-*'],
  cssFiles: ['./styles.css'],
  tokenDefinitions: { light: { tokens: { 'xh-btn-bg': '#fff' } } },
  group: 'controls',
})
```

| Поле | Зачем |
|---|---|
| `dependencies` | компоненты, чей код этот компонент импортирует; короткая форма — тот же провайдер, `id:Name` — чужой |
| `safelist` | только классы, которые собираются в JS в рантайме; литералы шаблона сюда не пишутся — их извлечёт сборка |
| `dynamicTokens` | токены, чьё имя собирается в рантайме; обрезка их не удалит, пока компонент в сборке |
| `cssFiles` | CSS, читаемый как есть; путь относительно `config.ts`, внутри директории компонента |
| `tokenDefinitions` | структурные токены компонента по темам; ключи без `--` |
| `group` | общие чанки нескольких компонентов кладутся в `groups/<g>/shared/` |

Первый аргумент — `import.meta.url` модуля `config.ts`: по нему сборка
находит директорию компонента и исходники `cssFiles`.

## Провайдер

```ts
import { defineGranumProvider } from '@feugene/granum/contract'

export default defineGranumProvider({
  id: '@acme/ui',
  contractVersion: 1,
  components: [xhCardConfig, xhButtonConfig],
  theme: {
    tokensCss: 'theme/tokens.css',
    baseCss: 'theme/base.css',
    themes: { light: 'theme/light.css', dark: 'theme/dark.css' },
    defaultThemes: ['light'],
    tokenDefinitions: { light: { tokens: { 'xh-accent': '#0a7' } } },
  },
  engine: { rules: [['btn-reset', { appearance: 'none' }]] },
  dependencies: ['@acme/base'],
})
```

`defineGranumProvider` проверяет форму при вызове: `contractVersion`, id,
имена компонентов, ключи токенов, пути `cssFiles`. Ошибки — типизированные
классы с полями `providerId`, `component`, `reason`.

Правила `engine` пишутся в типах granum (`GranumRule`, `GranumVariant`,
`GranumPreflight`) — форма та же, что у правил UnoCSS, но без импорта чужих
пакетов.

## Сборка

```ts
import { granumProvider } from '@feugene/granum/build'

granumProvider({
  provider,
  sourceDir: 'src',
  indexEntry: 'src/index.ts',
  dependencyCheck: 'error',
  boundaryCheck: 'error',
  exportsCheck: 'error',
})
```

Плагин:

1. строит `build.lib.entry` из реестра компонентов и раздаёт чанкам имена по
   раскладке;
2. извлекает статические классы из чанков каждого компонента экстрактором
   движка и оставляет только те, для которых есть правило;
3. собирает потребляемые токены: `var(--x)` в CSS, `var(--x)` и литералы
   `'--x'` в JS, `dynamicTokens`;
4. раскрывает `@apply` в CSS компонентов; в `dist` директив не остаётся;
5. строит фактический граф «компонент → компонент» по импортам бандла и
   сверяет с `dependencies`: неучтённое ребро — `UndeclaredDependencyError`;
6. проверяет, что браузерный код не импортирует `node:*` и node-entry granum
   (`BoundaryViolationError`), а `package.json#exports` содержит манифест и
   subpath каждого компонента (`PackageExportsError`);
7. пишет `dist/granum.manifest.json`.

Импорт константы или типа из директории другого компонента зависимостью не
является и объявлять его не нужно: рёбра считаются по коду, попавшему в
чанки чужого компонента.

## Codegen

Реестр провайдера, barrel и `exports` генерируются из директорий
компонентов. Стандартный набор целей доступен из CLI —
`granum codegen` и `granum codegen --check` для CI (см. [CLI](./cli.md));
свои цели — программно:

```js
// scripts/generate-registry.mjs
import { fileURLToPath } from 'node:url'
import { codegenTargets, runRegistryCodegen } from '@feugene/granum/codegen'

await runRegistryCodegen({
  packageDir: fileURLToPath(new URL('..', import.meta.url)),
  check: process.argv.includes('--check'),
  targets: [
    codegenTargets.barrel(),
    codegenTargets.packageExports(),
    codegenTargets.manifestExport(),
    ...codegenTargets.providerRegistry(),
  ],
})
```

## Чек-лист перед релизом

- `vite build` проходит без предупреждений `safelist-redundant` и
  `css-double-delivery`, либо они объяснены;
- `granum.manifest.json` в `exports`; `sideEffects: false`;
- `dependencies` компонентов покрывают импорты — сборка иначе не пройдёт;
- кросс-провайдерный донор перечислен в `peerDependencies`;
- `doctor --strict` приложения-потребителя выходит с кодом `0`.
