// То же, что themes.mjs, но с components: 'all' (как у портала и в примере страницы «Темизация»).
const nm = '/Volumes/dev/feugene/js/projects/granularity-site/node_modules/@feugene/'
const node = await import(nm + 'granum/dist/node.js')
const { windEngine } = await import(nm + 'granum-engine-wind/dist/index.js')
const root = new URL('../app-src/', import.meta.url).pathname
async function run(label, themes) {
  const app = await node.prepareApp({ engine: windEngine(), providers: ['@feugene/granularity'], themes }, root)
  const out = await node.emitCss(app)
  const L = out.layers.themes
  const i = L.indexOf('#4fd1e0'); const before = L.lastIndexOf('}', i); const selStart = L.lastIndexOf('\n', L.lastIndexOf('{', i))
  console.log('\n=====', label)
  console.log('override lands in block:', JSON.stringify(L.slice(L.lastIndexOf('\n', L.lastIndexOf('{', i) - 1) + 1, L.indexOf('{', L.lastIndexOf('\n', L.lastIndexOf('{', i) - 1) + 1)).trim()))
  console.log('override offset', i, '| dark.css offset', L.indexOf("[data-theme='dark'],\n.dark"), '| light.css offset', L.indexOf(":root,\n[data-theme='light']"))
  console.log('line with value:', JSON.stringify(L.split('\n').find(l => l.includes('#4fd1e0'))))
  console.log('warnings:', JSON.stringify(app.resolution.warnings), '| doctor:', (await node.granumDoctor(app)).diagnostics.filter(d => d.code !== 'token-conflict').map(d => d.code).join(',') || '[]')
  console.log('theme manifest:', JSON.stringify(node.getThemeManifest(app.resolution).themes.map(t => ({ n: t.name, a: t.activation }))))
}
await run('tokenOverrides dark {"--gr-primary"} (пример страницы)', { names: ['light', 'dark'], tokenOverrides: { dark: { '--gr-primary': '#4fd1e0' } } })
await run('tokenOverrides dark {"gr-primary"}', { names: ['light', 'dark'], tokenOverrides: { dark: { 'gr-primary': '#4fd1e0' } } })
await run('без overrides — манифест тем ядра', { names: ['light', 'dark'], tokenOverrides: { dark: { 'gr-zzz': '#4fd1e0' } } })
