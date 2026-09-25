import type { GranumComponentDescriptor, GranumLoadedManifest, GranumManifest, GranumManifestComponent, GranumProvider } from '../contract'
import { defineGranumProvider } from '../contract'

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
    granum: 1,
    contractVersion: 1,
    id,
    version: '0.0.0',
    generatedBy: '@feugene/granum@test',
    hash: `sha256-${id}`,
    dependencies: [],
    theme: { themes: {}, defaultThemes: [], tokenDefinitions: {}, declares: [] },
    engineModule: null,
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
