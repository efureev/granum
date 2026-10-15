// extraRules:false, своё правило фабрике, класс приложения без правила, themes по умолчанию. Только чтение.
import { mkdirSync, writeFileSync } from 'node:fs'
const nm = '/Volumes/dev/feugene/js/projects/granularity-site/node_modules/@feugene/'
const node = await import(nm + 'granum/dist/node.js')
const { windEngine } = await import(nm + 'granum-engine-wind/dist/index.js')
const root = new URL('../app-src/', import.meta.url).pathname
mkdirSync(root + 'src', { recursive: true })
writeFileSync(root + 'src/App.vue', '<template><span class="i-lucide-user text-red-500 not-a-rule-xyz" /></template>\n')
const base = { providers: ['@feugene/granularity'], components: [{ provider: '@feugene/granularity', names: ['GrButton'] }], appSources: { dirs: ['src'] } }

async function run(label, config) {
  const t0 = performance.now()
  const app = await node.prepareApp(config, root)
  const t1 = performance.now()
  const css = await node.emitCss(app)
  const report = node.buildReport(app, css)
  const doc = await node.granumDoctor(app)
  console.log('\n=====', label, `prepare ${Math.round(t1 - t0)} ms (manifests ${Math.round(app.timings.providers)})`)
  console.log('engine:', config.engine.dialect, config.engine.vocabulary)
  console.log('providers:', JSON.stringify(report.providers.map(p => ({ id: p.id, classes: p.classes, reason: p.reason, lost: p.lost.length, gained: p.gained.length }))))
  console.log('themes:', JSON.stringify(report.themes), 'unmatched:', JSON.stringify(report.classes.unmatched))
  console.log('doctor:', doc.diagnostics.map(d => `${d.level}:${d.code}`).join(', ') || '[]')
  return app
}
await run('A. ванильный движок, без themes', { ...base, engine: windEngine() })
await run('B. extraRules:false', { ...base, engine: windEngine({ extraRules: false }) })
const app = await run('C. своё правило фабрике', { ...base, engine: windEngine({ rules: [[/^i-lucide-(.+)$/, () => ({ 'mask': 'var(--un-icon)' })]] }) })
await run('C2. повтор (кэш процесса)', { ...base, engine: windEngine({ rules: [[/^i-lucide-(.+)$/, () => ({ 'mask': 'var(--un-icon)' })]] }) })
const app0 = await node.prepareApp({ ...base, engine: windEngine() }, root)
const why = await node.granumWhyCss(app0, 'i-lucide-user')
console.log('\nwhy-css i-lucide-user (vanilla):\n' + node.formatWhyCssReport(why).split('\n').slice(0, 12).join('\n'))
