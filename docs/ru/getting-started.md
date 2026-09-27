# Быстрый старт

> 🇬🇧 English version: [`../en/getting-started.md`](../en/getting-started.md).

Две стороны конвейера: **провайдер** (пакет компонентов) публикует `dist` с
манифестом, **приложение** собирает из манифестов CSS, JS и темы. Ниже —
минимальный путь для каждой стороны. Подробности — в
[руководстве по провайдерам](./authoring-providers.md) и
[руководстве по приложениям](./usage-in-apps.md).

## Установка

```bash
yarn add -D @feugene/granum @feugene/granum-engine-wind vite
```

Ядро не имеет зависимостей; `vite` — единственный peer, и нужен он только
точкам входа `./build` и `./vite`. Node ≥ 22, ESM. Движок утилит лежит в
отдельном пакете, потому что выбирает его приложение, а не granum — подробно
в [движках и диалектах](./engines-and-dialects.md).

## Провайдер за три шага

1. Дескриптор компонента рядом с его исходником:

```ts
// src/components/XhCard/config.ts
import { defineGranumComponent } from '@feugene/granum/contract'

export const xhCardConfig = defineGranumComponent(import.meta.url, {
  name: 'XhCard',
})
```

2. Провайдер собирает дескрипторы и объявляет фундамент:

```ts
// src/granum-provider/index.ts
import { defineGranumProvider } from '@feugene/granum/contract'
import { xhCardConfig } from '../components/XhCard/config.ts'

export default defineGranumProvider({
  id: '@acme/ui',
  contractVersion: 1,
  components: [xhCardConfig],
  theme: { tokensCss: 'theme/tokens.css', themes: { light: 'theme/light.css' }, defaultThemes: ['light'] },
})
```

3. Плагин сборки строит entry, раскладку и манифест:

```ts
// vite.config.ts
import { granumProvider } from '@feugene/granum/build'
import { windEngine } from '@feugene/granum-engine-wind'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import provider from './src/granum-provider/index.ts'

export default defineConfig({
  plugins: [vue(), granumProvider({ provider, engine: windEngine() })],
  build: { rolldownOptions: { external: ['vue'] } },
})
```

После `vite build` в `dist/` лежат `components/XhCard/index.js`,
`theme/*.css` и `granum.manifest.json`. В `package.json#exports` должны быть
`./granum.manifest.json` и `./components/XhCard` — сборка проверит это и
подскажет запустить codegen.

Движок сборке обязателен: его диалект и отпечаток словаря уезжают в блок
`engine` манифеста. Список классов там — факт о конкретной реализации, а не о
пакете, и приложение читает его именно так.

## Приложение за два шага

1. Конфиг:

```ts
// granum.config.ts
import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@acme/ui'],
  components: ['@acme/ui:XhCard'],
  appSources: { dirs: ['src'] },
})
```

`engine` обязателен и принимает инстанс: выбор реализации и её настройка
принадлежат приложению. Свои правила приложение отдаёт фабрике движка
(`windEngine({ rules: […] })`), а не конфигу.

2. Плагин и один импорт CSS:

```ts
// vite.config.ts
import { granum } from '@feugene/granum/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import config from './granum.config.ts'

export default defineConfig({ plugins: [vue(), granum(config)] })
```

```ts
// src/main.ts
import 'virtual:granum.css'
```

`virtual:granum.css` содержит пять каскадных слоёв: `tokens`, `base`,
`themes`, `components`, `utilities`. Классы шаблонов приложения извлекаются
из `appSources`, классы компонентов — из манифестов, `unocss` в приложении не
нужен.

## Проверить, что всё сошлось

```bash
npx granum doctor granum.config.ts
```

Отчёт перечисляет провайдеров, селекцию, темы и диагностику. После сборки
рядом с бандлом появляется `dist/granum-report.json` — про него в
[CLI](./cli.md) и [замере веса](./measuring-weight.md).
