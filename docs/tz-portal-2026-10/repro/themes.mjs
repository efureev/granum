// Темизация: tokenOverrides / define против тем-файлов провайдера. Только чтение.
const nm = '/Volumes/dev/feugene/js/projects/granularity-site/node_modules/@feugene/'
const node = await import(nm + 'granum/dist/node.js')
const { windEngine } = await import(nm + 'granum-engine-wind/dist/index.js')
const root = '/Volumes/dev/feugene/js/projects/granularity-site'

function themeLayerOutline(css) {
  // селекторы блоков слоя themes в порядке появления + строки с gr-primary/gr-bg
  const out = []
  for (const line of css.split('\n')) {
    if (/\{\s*$/.test(line) && !line.trim().startsWith('@')) out.push('SEL ' + line.trim())
    else if (/gr-primary:|gr-bg:/.test(line) && out.length && out[out.length-1].startsWith('SEL')) out.push('     ' + line.trim())
  }
  return out
}

async function run(label, themes) {
  const app = await node.prepareApp({ engine: windEngine(), providers: ['@feugene/granularity'], components: [], themes }, root)
  const out = await node.emitCss(app)
  const L = out.layers.themes
  console.log('\n=====', label)
  console.log('names:', app.resolution.themes.names, 'namesSource:', app.resolution.themes.namesSource)
  console.log('resolution.warnings:', JSON.stringify(app.resolution.warnings))
  const idxBlocks = L.indexOf('#4fd1e0')
  const idxLightFile = L.indexOf("[data-theme='light']")
  const idxDarkFile = L.indexOf("[data-theme='dark']")
  console.log('pos override value:', idxBlocks, ' pos light file:', idxLightFile, ' pos dark file:', idxDarkFile)
  const head = L.slice(0, Math.max(0, L.indexOf('/*')) || 300)
  console.log('themes layer head (before first file comment):\n' + L.slice(0, 260))
  // эффективное значение по версии granum
  for (const t of app.resolution.themes.names) {
    const v = node.resolveTokenValue(app.resolution, t, 'gr-primary')
    const v2 = node.resolveTokenValue(app.resolution, t, '--gr-primary')
    if (v !== undefined || v2 !== undefined) console.log(`resolveTokenValue(${t}, gr-primary)=`, v, ' (--gr-primary)=', v2)
  }
  const doc = await node.granumDoctor(app)
  const codes = doc.diagnostics.map(d => `${d.level}:${d.code}:${d.subject}`)
  console.log('doctor diagnostics:', codes.length ? codes : '[]')
  const tm = node.getThemeManifest(app.resolution)
  console.log('theme manifest:', JSON.stringify(tm.themes))
  return { app, out }
}

await run('1. tokenOverrides dark {"--gr-primary"}', { names: ['light', 'dark'], tokenOverrides: { dark: { '--gr-primary': '#4fd1e0' } } })
await run('2. tokenOverrides dark {"gr-primary"}', { names: ['light', 'dark'], tokenOverrides: { dark: { 'gr-primary': '#4fd1e0' } } })
await run('3. tokenOverrides dark {selector form}', { names: ['light', 'dark'], tokenOverrides: { dark: { "[data-theme='dark']": { 'gr-primary': '#4fd1e0' } } } })
await run('4. define ocean extends dark (opaque)', { names: ['light', 'dark', 'ocean'], define: { ocean: { extends: 'dark', selector: '[data-theme="ocean"]', tokens: { 'gr-primary': '#4fd1e0', 'gr-bg': '#062b32' } } } })
await run('5. define ocean, selector :root[data-theme=ocean]', { names: ['light', 'dark', 'ocean'], define: { ocean: { selector: ':root[data-theme="ocean"]', tokens: { 'gr-primary': '#4fd1e0' } } } })
await run('6. define tokens with -- key', { names: ['light', 'dark', 'ocean'], define: { ocean: { tokens: { '--gr-primary': '#4fd1e0' } } } })
await run('7. strictTokens + override on file theme', { names: ['light', 'dark'], strictTokens: true, tokenOverrides: { dark: { 'gr-primary': '#4fd1e0' } } })
