// Манифест тем (virtual:granum/themes) для тем-файлов ядра в зависимости от селекции.
const nm = '/Volumes/dev/feugene/js/projects/granularity-site/node_modules/@feugene/'
const node = await import(nm + 'granum/dist/node.js')
const { windEngine } = await import(nm + 'granum-engine-wind/dist/index.js')
const root = new URL('../app-src/', import.meta.url).pathname
const P = '@feugene/granularity'
for (const [label, components, extra] of [
  ['components: []', [], {}],
  ['components: [GrDivider]', [`${P}:GrDivider`], {}],
  ['components: [GrButton]', [`${P}:GrButton`], {}],
  ["components: 'all'", 'all', {}],
  ['components: [] + tokenOverrides.dark', [], { tokenOverrides: { dark: { 'gr-primary': '#4fd1e0' } } }],
]) {
  const app = await node.prepareApp({ engine: windEngine(), providers: [P], components, themes: { names: ['light', 'dark'], ...extra } }, root)
  const tm = node.getThemeManifest(app.resolution)
  console.log(label.padEnd(40), tm.themes.map(t => `${t.name}=${t.activation.type}${t.activation.value ? ':' + t.activation.value : ''} [${t.selectors.join(' | ')}]`).join('   '))
}
