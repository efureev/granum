const nm = '/Volumes/dev/feugene/js/projects/granularity-site/node_modules/@feugene/'
const node = await import(nm + 'granum/dist/node.js')
const { windEngine } = await import(nm + 'granum-engine-wind/dist/index.js')
const root = new URL('../app-src/', import.meta.url).pathname
const app = await node.prepareApp({ engine: windEngine(), providers: ['@feugene/granularity'], components: [{ provider: '@feugene/granularity', names: ['GrButton'] }], themes: { names: ['light', 'dark'], tokenOverrides: { dark: { 'gr-primary': '#4fd1e0' } } } }, root)
const rep = node.granumTokens(app, '@feugene/granularity:GrButton', 'deep')
const txt = node.formatTokensReport(rep)
console.log(txt.split('\n').filter(l => /gr-primary\b|Theme|theme|=====|granum tokens/.test(l)).slice(0, 20).join('\n'))
