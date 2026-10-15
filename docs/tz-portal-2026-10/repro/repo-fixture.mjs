// Воспроизведение ТЗ-1/ТЗ-2/ТЗ-5 на фикстуре самого granum (@granum-fixtures/mini-ds, темы файлами).
const G = '/Volumes/dev/feugene/js/packages/granum'
const node = await import(G + '/packages/granum/dist/node.js')
const { windEngine } = await import(G + '/packages/granum-engine-wind/dist/index.js')
const root = G + '/apps/app-1/'
const tok = process.argv[2] ?? 'xx-primary'
for (const [label, themes] of [
  ['tokenOverrides.dark', { names: ['light', 'dark'], tokenOverrides: { dark: { [tok]: '#4fd1e0' } } }],
  ["tokenOverrides.dark '--'", { names: ['light', 'dark'], tokenOverrides: { dark: { ['--' + tok]: '#4fd1e0' } } }],
  ['define ocean extends dark', { names: ['light', 'dark', 'ocean'], define: { ocean: { extends: 'dark', tokens: { [tok]: '#4fd1e0' } } } }],
]) {
  const app = await node.prepareApp({ engine: windEngine(), providers: ['@granum-fixtures/mini-ds'], themes }, root)
  const L = (await node.emitCss(app)).layers.themes
  const lines = L.split('\n')
  const sel = lines.filter(l => /\{\s*$/.test(l)).map(l => l.trim())
  console.log(`\n== ${label}: selectors in granum.themes, in order:`, JSON.stringify(sel))
  console.log('   line with value:', JSON.stringify(lines.find(l => l.includes('#4fd1e0'))), '| warnings:', JSON.stringify(app.resolution.warnings))
  console.log('   theme manifest:', JSON.stringify(node.getThemeManifest(app.resolution).themes.map(t => [t.name, t.activation])))
}
