import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLI_COMMANDS, formatBuildReport, runGranumCli, USAGE } from '../cli'
import { ConfigLoadError, loadGranumConfigFile } from '../cli/loadConfig'
import { serializeManifest } from '../node/manifest'
import { makeManifest } from './helpers'

interface Io { out: string[], err: string[], io: { stdout: (l: string) => void, stderr: (l: string) => void, cwd: string } }

function io(cwd = '/'): Io {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { stdout: l => out.push(l), stderr: l => err.push(l), cwd } }
}

/** Приложение на диске: провайдер-манифест в node_modules, `granum.config.mjs`, отчёт сборки. */
function appDir(patch: { config?: string, reportExtra?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'granum-cli-'))
  const dist = join(root, 'node_modules/@x/kit/dist')
  mkdirSync(join(dist, 'components/Card'), { recursive: true })
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'node_modules/@x/kit/package.json'), JSON.stringify({ name: '@x/kit', version: '1.0.0', exports: { './granum.manifest.json': './dist/granum.manifest.json' } }))
  writeFileSync(join(dist, 'components/Card/styles.css'), '.card{padding:var(--space)}\n')
  writeFileSync(join(dist, 'components/Card/index.js'), 'export const Card = 1\n')
  const { manifest } = makeManifest('@x/kit', {
    Card: { classes: ['p-4'], css: ['components/Card/styles.css'], safelist: ['no-such-rule'], tokens: { declares: {}, consumes: ['--space'], dynamic: [] } },
  }, { theme: { themes: {}, defaultThemes: [], tokenDefinitions: { light: { tokens: { space: '8px' } } }, declares: ['--space'] } })
  writeFileSync(join(dist, 'granum.manifest.json'), serializeManifest(manifest))
  writeFileSync(join(root, 'granum.config.mjs'), patch.config ?? `export default { providers: ['@x/kit'], components: ['@x/kit:Card'] }\n`)
  writeFileSync(join(root, 'dist/granum-report.json'), JSON.stringify({
    generatedBy: '@feugene/granum@test',
    selection: [{ key: '@x/kit:Card', dependencies: [] }],
    themes: { names: ['light'], namesSource: 'fallback' },
    classes: { input: 2, matched: 1, unmatched: [{ className: 'no-such-rule', sources: ['safelist:@x/kit:Card'] }], safelistRedundant: [] },
    tokens: { undefined: [] },
    prune: null,
    sizes: { tokens: { raw: 0, gzip: 20, brotli: 1 }, base: { raw: 0, gzip: 20, brotli: 1 }, themes: { raw: 21, gzip: 30, brotli: 25 }, components: { raw: 26, gzip: 40, brotli: 30 }, utilities: { raw: 22, gzip: 40, brotli: 30 }, total: { raw: 69, gzip: 80, brotli: 70 } },
    warnings: ['something'],
    ...(patch.reportExtra ? JSON.parse(patch.reportExtra) : {}),
  }))
  return root
}

describe('granum cli: вызов и коды выхода (INV-ERR-3)', () => {
  it('usage без аргументов, --help и -h — код 0; неизвестная команда — код 2', async () => {
    for (const argv of [[], ['--help'], ['-h'], ['doctor', '--help']]) {
      const t = io()
      expect(await runGranumCli(argv, t.io)).toBe(0)
      expect(t.out).toEqual([USAGE])
    }
    const t = io()
    expect(await runGranumCli(['frobnicate'], t.io)).toBe(2)
    expect(t.err[0]).toContain('unknown command \'frobnicate\'')
    expect(t.err[0]).toContain('usage:')
  })

  it('версия', async () => {
    const t = io()
    expect(await runGranumCli(['--version'], t.io)).toBe(0)
    expect(t.out).toEqual(['0.0.0-test'])
  })

  it('каждая команда описана в usage; без <config> или предмета — код 2', async () => {
    for (const c of CLI_COMMANDS)
      expect(USAGE).toContain(`granum ${c}`)
    for (const argv of [['doctor'], ['explain', 'granum.config.mjs'], ['tokens', 'granum.config.mjs'], ['why-css', 'granum.config.mjs']]) {
      const t = io()
      expect(await runGranumCli(argv, t.io)).toBe(2)
      expect(t.err[0]).toContain('missing')
    }
  })

  it('ошибка загрузки конфига — код 1 и сообщение с префиксом', async () => {
    const root = appDir({ config: 'export const nothing = 1\n' })
    const t = io(root)
    expect(await runGranumCli(['doctor', 'granum.config.mjs'], t.io)).toBe(1)
    expect(t.err[0]).toContain('[granum] Cannot load granum config')
    expect(t.err[0]).toContain('exports neither default, granum nor config')
    const missing = io(root)
    expect(await runGranumCli(['doctor', 'nope.config.mjs'], missing.io)).toBe(1)
    expect(missing.err[0]).toContain('[granum]')
  })

  it('doctor: 0 при предупреждениях, 1 с --strict; --json даёт отчёт', async () => {
    const root = appDir()
    const plain = io(root)
    expect(await runGranumCli(['doctor', 'granum.config.mjs'], plain.io)).toBe(0)
    expect(plain.out[0]).toContain('[safelist-dead] @x/kit:Card')
    const strict = io(root)
    expect(await runGranumCli(['doctor', 'granum.config.mjs', '--strict'], strict.io)).toBe(1)
    const json = io(root)
    expect(await runGranumCli(['--json', 'doctor', 'granum.config.mjs'], json.io)).toBe(0)
    const report = JSON.parse(json.out[0]!)
    expect(report.ok).toBe(true)
    expect(report.diagnostics.map((d: { code: string }) => d.code)).toEqual(['safelist-dead'])
  })

  it('doctor: ошибка манифеста (нет файла) — код 1 и без --strict', async () => {
    const root = appDir()
    writeFileSync(join(root, 'node_modules/@x/kit/dist/components/Card/styles.css'), '.card{@apply p-2}')
    const t = io(root)
    expect(await runGranumCli(['doctor', 'granum.config.mjs'], t.io)).toBe(1)
    expect(t.out[0]).toContain('[apply-not-expanded]')
  })

  it('explain, tokens, why-css: 0 при попадании, 1 при промахе', async () => {
    const root = appDir()
    const hit = io(root)
    expect(await runGranumCli(['explain', 'granum.config.mjs', 'Card', '--json'], hit.io)).toBe(0)
    expect(JSON.parse(hit.out[0]!).reason).toBe('selected')
    const miss = io(root)
    expect(await runGranumCli(['explain', 'granum.config.mjs', 'Nope'], miss.io)).toBe(1)
    expect(miss.out[0]).toContain('Known components')
    const tokens = io(root)
    expect(await runGranumCli(['tokens', 'granum.config.mjs', '@x/kit:Card', '--deep'], tokens.io)).toBe(0)
    expect(tokens.out[0]).toContain('--space')
    const tokensMiss = io(root)
    expect(await runGranumCli(['tokens', 'granum.config.mjs', 'Nope'], tokensMiss.io)).toBe(1)
    const why = io(root)
    expect(await runGranumCli(['why-css', 'granum.config.mjs', 'p-4'], why.io)).toBe(0)
    expect(why.out[0]).toContain('static class of a component (manifest): @x/kit:Card')
    const whyMiss = io(root)
    expect(await runGranumCli(['why-css', 'granum.config.mjs', 'm-1'], whyMiss.io)).toBe(1)
  })

  it('prune: 0 всегда, 1 с --strict при наличии удаляемых', async () => {
    const root = appDir({ config: `export default { providers: ['@x/kit'], components: ['@x/kit:Card'], themes: { tokenOverrides: { light: { extra: '1' } } } }\n` })
    const t = io(root)
    expect(await runGranumCli(['prune', 'granum.config.mjs', '--json'], t.io)).toBe(0)
    expect(JSON.parse(t.out[0]!).mode).toBe('off')
  })

  it('report: читает dist/granum-report.json по умолчанию, --strict падает на unmatched', async () => {
    const root = appDir()
    const t = io(root)
    expect(await runGranumCli(['report'], t.io)).toBe(0)
    expect(t.out[0]).toContain('✗ no-such-rule ← safelist:@x/kit:Card')
    expect(t.out[0]).toContain('⚠ something')
    const strict = io(root)
    expect(await runGranumCli(['report', 'dist/granum-report.json', '--strict'], strict.io)).toBe(1)
    const json = io(root)
    expect(await runGranumCli(['report', '--json'], json.io)).toBe(0)
    expect(JSON.parse(json.out[0]!).classes.matched).toBe(1)
    const clean = appDir({ reportExtra: JSON.stringify({ classes: { input: 1, matched: 1, unmatched: [], safelistRedundant: [] } }) })
    expect(await runGranumCli(['report', '--strict'], io(clean).io)).toBe(0)
    expect(formatBuildReport(JSON.parse(json.out[0]!))).toContain('utilities         22       40       30')
  })
})

describe('loadGranumConfigFile', () => {
  it('принимает default, granum и config; проверяет форму конфига', async () => {
    const root = appDir({ config: `export const granum = { providers: ['@x/kit'] }\n` })
    const loaded = await loadGranumConfigFile('granum.config.mjs', root)
    expect(loaded.root).toBe(root)
    expect(loaded.config.providers).toEqual(['@x/kit'])
    writeFileSync(join(root, 'bad.config.mjs'), 'export const config = { providers: "nope" }\n')
    await expect(loadGranumConfigFile('bad.config.mjs', root)).rejects.toBeInstanceOf(ConfigLoadError)
  })

  it('ts-конфиг без vite в корне грузится нативно', async () => {
    const root = appDir()
    writeFileSync(join(root, 'granum.config.ts'), `const providers: string[] = ['@x/kit']\nexport default { providers }\n`)
    const loaded = await loadGranumConfigFile('granum.config.ts', root)
    expect(loaded.config.providers).toEqual(['@x/kit'])
  })
})
