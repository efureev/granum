import type { GranumConfig } from '../config'
import type { GranumComponentDescriptor, GranumLoadedManifest, GranumManifest, GranumManifestComponent, GranumProvider } from '../contract'
import type { GranumEngine } from '../engine/types'
import type { PreparedApp } from '../node/prepare'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineGranumProvider } from '../contract'
import { prepareApp } from '../node/prepare'
import { testEngine } from './testEngine'

/** Движок тестов один на прогон: его диалект и отпечаток попадают в фикстуры манифестов. */
export const TEST_ENGINE = testEngine()

/**
 * `prepareApp` с движком по умолчанию: движок в конфиге обязателен (A-E1), а
 * тестам интересен не он, а резолюция. Тест, которому нужен другой словарь,
 * передаёт свой инстанс.
 */
export function prepareTestApp(
  config: Omit<GranumConfig, 'engine'> & { readonly engine?: GranumEngine },
  root: string,
): Promise<PreparedApp> {
  return prepareApp({ ...config, engine: config.engine ?? TEST_ENGINE } as GranumConfig, root)
}

/** Провайдер объектной формы с минимумом полей. */
export function makeProvider(
  id: string,
  patch: Partial<Omit<GranumProvider, 'id' | 'contractVersion'>> = {},
): GranumProvider {
  return defineGranumProvider({
    id,
    contractVersion: 1,
    baseUrl: `file:///${id.replace(/[^\w-]/g, '_')}/`,
    components: [],
    ...patch,
  })
}

export function component(name: string, patch: Partial<GranumComponentDescriptor> = {}): GranumComponentDescriptor {
  return { name, ...patch }
}

/** Манифест с заполненными обязательными полями; `hash` фиктивный — читатель появится на этапе 3. */
export function makeManifest(
  id: string,
  components: Record<string, Partial<GranumManifestComponent>> = {},
  patch: Partial<Omit<GranumManifest, 'id' | 'components'>> = {},
): GranumLoadedManifest {
  const manifest: GranumManifest = {
    granum: 2,
    contractVersion: 1,
    id,
    version: '0.0.0',
    generatedBy: '@feugene/granum@test',
    hash: `sha256-${id}`,
    dependencies: [],
    theme: { themes: {}, defaultThemes: [], tokenDefinitions: {}, declares: [] },
    engine: { dialect: TEST_ENGINE.dialect, vocabulary: TEST_ENGINE.vocabulary, name: TEST_ENGINE.name, module: null },
    components: Object.fromEntries(Object.entries(components).map(([name, c]) => [name, {
      entry: `components/${name}/index.js`,
      files: [`components/${name}/index.js`],
      css: [],
      group: null,
      dependencies: [],
      classes: [],
      safelist: [],
      tokens: { declares: {}, consumes: [], dynamic: [] },
      hash: `sha256-${name}`,
      ...c,
    }])),
    warnings: [],
    ...patch,
  }
  return { manifest, baseUrl: `file:///node_modules/${id}/dist/` }
}

/**
 * Провайдер с темами-файлами, как ядро granularity: `light` под `:root` (тема по
 * умолчанию), `dark` под атрибутом и классом. У компонента `Tinted` есть
 * структурный блок тёмной темы под атрибутом — так селекция начинает влиять на
 * тему-файл; у `Bare` — такой же блок без селектора. `files` подменяет текст
 * файла темы; `null` — файла на диске нет.
 */
export function fileThemeProvider(files: { readonly light?: string | null, readonly dark?: string | null } = {}): { root: string, dist: string, provider: GranumLoadedManifest } {
  const root = mkdtempSync(join(tmpdir(), 'granum-file-theme-'))
  const dist = join(root, 'node_modules/@p/ds/dist')
  mkdirSync(join(dist, 'theme'), { recursive: true })
  const css = {
    light: `:root, [data-theme='light'], .light {\n  --p-bg: #ffffff;\n  --p-primary: #2563eb;\n}\n`,
    dark: `[data-theme='dark'], .dark {\n  --p-bg: #0f172a;\n  --p-primary: #60a5fa;\n}\n`,
    ...files,
  }
  for (const [theme, text] of Object.entries(css)) {
    if (text !== null)
      writeFileSync(join(dist, `theme/${theme}.css`), text)
  }
  const loaded = makeManifest('@p/ds', {
    Plain: {},
    Tinted: { tokens: { declares: { dark: { selector: '[data-theme="dark"]', tokens: { 'p-tint': '#334155' } } }, consumes: [], dynamic: [] } },
    Bare: { tokens: { declares: { dark: { tokens: { 'p-shade': '#020617' } } }, consumes: [], dynamic: [] } },
  }, {
    theme: {
      themes: { light: 'theme/light.css', dark: 'theme/dark.css' },
      defaultThemes: ['light', 'dark'],
      tokenDefinitions: {},
      declares: ['--p-bg', '--p-primary'],
    },
  })
  return { root, dist, provider: { manifest: loaded.manifest, baseUrl: `${pathToFileURL(dist).href}/` } }
}
