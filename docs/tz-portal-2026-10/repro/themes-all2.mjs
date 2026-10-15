const nm = '/Volumes/dev/feugene/js/projects/granularity-site/node_modules/@feugene/'
const node = await import(nm + 'granum/dist/node.js')
const { windEngine } = await import(nm + 'granum-engine-wind/dist/index.js')
const root = new URL('../app-src/', import.meta.url).pathname
for (const strictTokens of [false, true]) {
  const app = await node.prepareApp({ engine: windEngine(), providers: ['@feugene/granularity'], themes: { names: ['light', 'dark'], strictTokens, tokenOverrides: { dark: { 'gr-primary': '#4fd1e0' } } } }, root)
  console.log(`strictTokens=${strictTokens}: resolveTokenValue(dark, gr-primary) =`, node.resolveTokenValue(app.resolution, 'dark', 'gr-primary'), '| warnings', JSON.stringify(app.resolution.warnings))
}
const m = (await import(nm + 'granularity/dist/granum.manifest.json', { with: { type: 'json' } })).default
console.log('manifest.theme.declares has --gr-primary:', m.theme.declares.includes('--gr-primary'))
