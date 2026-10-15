// define ocean extends dark — пример страницы «Темизация» байт в байт, components по умолчанию ('all').
const nm = '/Volumes/dev/feugene/js/projects/granularity-site/node_modules/@feugene/'
const node = await import(nm + 'granum/dist/node.js')
const { windEngine } = await import(nm + 'granum-engine-wind/dist/index.js')
const root = new URL('../app-src/', import.meta.url).pathname
for (const components of ['all', []]) {
  const app = await node.prepareApp({ engine: windEngine(), providers: ['@feugene/granularity'], components, themes: { names: ['light', 'dark', 'ocean'], define: { ocean: { extends: 'dark', selector: '[data-theme="ocean"]', tokens: { 'gr-primary': '#4fd1e0', 'gr-bg': '#062b32' } } } } }, root)
  const out = await node.emitCss(app)
  const L = out.layers.themes
  const start = L.indexOf('[data-theme="ocean"] {'); const end = L.indexOf('}', start)
  const block = L.slice(start, end)
  const decls = block.split('\n').filter(l => l.trim().startsWith('--'))
  const roles = decls.filter(l => /--gr-(bg|fg|primary|card|muted|danger|success)\b/.test(l))
  console.log(`components=${JSON.stringify(components)}: ocean block: ${decls.length} declarations, of them roles: ${roles.map(r => r.trim().split(':')[0]).join(' ')}`)
  console.log('  sample:', decls.slice(0, 3).map(s => s.trim()).join(' | '))
  console.log('  ocean block offset', start, '< light.css offset', L.indexOf(":root,\n[data-theme='light']"), '| warnings', JSON.stringify(app.resolution.warnings))
}
{
  const { grThemeTokens } = await import(nm + 'granularity/dist/tokens.js')
  const roles = new Set(grThemeTokens.map(t => (typeof t === 'string' ? t : t.name)))
  const app = await node.prepareApp({ engine: windEngine(), providers: ['@feugene/granularity'], themes: { names: ['light', 'dark', 'ocean'], define: { ocean: { extends: 'dark', selector: '[data-theme="ocean"]', tokens: { 'gr-primary': '#4fd1e0', 'gr-bg': '#062b32' } } } } }, root)
  const L = (await node.emitCss(app)).layers.themes
  const s = L.indexOf('[data-theme="ocean"] {'); const block = L.slice(s, L.indexOf('}', s))
  const names = block.split('\n').filter(l => l.trim().startsWith('--')).map(l => l.trim().split(':')[0])
  const isRole = n => roles.has(n) || roles.has(n.slice(2))
  console.log('roles known:', roles.size, '| ocean decls:', names.length, '| theme roles among them:', names.filter(isRole).join(' '))
}
