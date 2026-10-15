const nm = '/Volumes/dev/feugene/js/projects/granularity-site/node_modules/@feugene/'
const node = await import(nm + 'granum/dist/node.js')
const vite = await import(nm + 'granum/dist/vite.js')
const { windEngine } = await import(nm + 'granum-engine-wind/dist/index.js')
const root = new URL('../app-src/', import.meta.url).pathname
const cfg = { engine: windEngine(), providers: ['@feugene/granularity'], components: [], themes: { names: ['light', 'dark'], themeFiles: { dark: './src/my-dark.css' } }, appSource: { dirs: ['src'] } }
try { vite.granum(cfg); console.log('granum(): accepted config with themes.themeFiles and typo appSource') } catch (e) { console.log('granum() threw', e.message) }
const app = await node.prepareApp(cfg, root)
const out = await node.emitCss(app)
console.log('my-dark.css mentioned in CSS:', out.css.includes('my-dark'), ' warnings:', JSON.stringify(app.resolution.warnings), ' app classes scanned:', app.appScan.classes.length)
