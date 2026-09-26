# Getting started

> 🇷🇺 Русская версия: [`../ru/getting-started.md`](../ru/getting-started.md).

The pipeline has two sides: a **provider** (a component package) publishes a
`dist` with a manifest, an **application** builds CSS, JS and themes from the
manifests. Below is the shortest path for each side. Details live in the
[provider guide](./authoring-providers.md) and the
[application guide](./usage-in-apps.md).

## Install

```bash
yarn add -D @feugene/granum @feugene/granum-engine-mini vite
```

The core has no dependencies; `vite` is the only peer and is needed only by
the `./build` and `./vite` entry points. Node ≥ 22, ESM. The utility engine
lives in its own package because the application picks it, not granum — see
[engines and dialects](./engines-and-dialects.md) for the details.

## A provider in three steps

1. A component descriptor next to its source:

```ts
// src/components/XhCard/config.ts
import { defineGranumComponent } from '@feugene/granum/contract'

export const xhCardConfig = defineGranumComponent(import.meta.url, {
  name: 'XhCard',
})
```

2. The provider collects descriptors and declares its foundation:

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

3. The build plugin creates the entries, the layout and the manifest:

```ts
// vite.config.ts
import { granumProvider } from '@feugene/granum/build'
import { miniEngine } from '@feugene/granum-engine-mini'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import provider from './src/granum-provider/index.ts'

export default defineConfig({
  plugins: [vue(), granumProvider({ provider, engine: miniEngine() })],
  build: { rolldownOptions: { external: ['vue'] } },
})
```

After `vite build`, `dist/` holds `components/XhCard/index.js`, `theme/*.css`
and `granum.manifest.json`. `package.json#exports` must list
`./granum.manifest.json` and `./components/XhCard` — the build checks that
and points to codegen.

The build requires an engine: its dialect and vocabulary fingerprint go into
the manifest's `engine` block. The class list there is a fact about one
implementation, not about the package, and applications read it as such.

## An application in two steps

1. The config:

```ts
// granum.config.ts
import { defineGranumConfig } from '@feugene/granum/vite'
import { miniEngine } from '@feugene/granum-engine-mini'

export default defineGranumConfig({
  engine: miniEngine(),
  providers: ['@acme/ui'],
  components: ['@acme/ui:XhCard'],
  appSources: { dirs: ['src'] },
})
```

`engine` is required and takes an instance: choosing an implementation and
configuring it belong to the application. Its own rules go to the engine
factory (`miniEngine({ rules: […] })`), not to the config.

2. The plugin and a single CSS import:

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

`virtual:granum.css` contains five cascade layers: `tokens`, `base`,
`themes`, `components`, `utilities`. Classes of application templates are
extracted from `appSources`, classes of components come from the manifests;
the application does not need `unocss`.

## Check that everything lines up

```bash
npx granum doctor granum.config.ts
```

The report lists providers, the selection, themes and diagnostics. After a
build, `dist/granum-report.json` appears next to the bundle — see
[CLI](./cli.md) and [measuring weight](./measuring-weight.md).
