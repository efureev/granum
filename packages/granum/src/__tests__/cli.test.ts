import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLI_COMMANDS, formatBuildReport, runGranumCli, USAGE } from '../cli'
import { ConfigLoadError, loadGranumConfigFile } from '../cli/loadConfig'
import { serializeManifest } from '../node/manifest'
import { makeManifest } from './helpers'

/**
 * Движок приложения для CLI-фикстуры: конфиг обязан передать инстанс (A-E1), а
 * `.mjs`-конфиг грузится нативно — значит, движок тоже обычный `.mjs`-модуль
 * рядом. Знает ровно `p-4`: этого хватает, чтобы `p-4` попал в `matched`, а
 * `no-such-rule` из safelist остался мёртвым.
 */
const ENGINE_MJS = `export function engine() {
  return {
    name: 'cli-test-engine',
    dialect: 'granum-tests/mini@1',
    vocabulary: 'fnv64-clitestengine01',
    extract: code => new Set(code.split(/[\\s"'\`;{}]+/).filter(Boolean)),
    generate: async (input) => {
      const matched = new Map()
      const unmatched = []
      let css = ''
      for (const cls of [...input.classes].sort()) {
        if (cls === 'p-4') {
          matched.set(cls, { rule: 'p-4', selector: '.p-4', source: 'builtin', layer: 'default' })
          css += '.p-4{padding:1rem;}'
        }
        else {
          unmatched.push(cls)
        }
      }
      return { css, matched, unmatched }
    },
  }
}
`

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
  }, {
    theme: { themes: {}, defaultThemes: [], tokenDefinitions: { light: { tokens: { space: '8px' } } }, declares: ['--space'] },
    // Пакет собран тем же движком, что стоит в конфиге: отпечатки совпадают,
    // классы берутся из манифеста без пересчёта (A-E3).
    engine: { dialect: 'granum-tests/mini@1', vocabulary: 'fnv64-clitestengine01', name: 'cli-test-engine', module: null },
  })
  writeFileSync(join(dist, 'granum.manifest.json'), serializeManifest(manifest))
  writeFileSync(join(root, 'granum.engine.mjs'), ENGINE_MJS)
  writeFileSync(join(root, 'granum.config.mjs'), patch.config ?? `import { engine } from './granum.engine.mjs'\nexport default { providers: ['@x/kit'], engine: engine(), components: ['@x/kit:Card'] }\n`)
  writeFileSync(join(root, 'dist/granum-report.json'), JSON.stringify({
    generatedBy: '@feugene/granum@test',
    selection: [{ key: '@x/kit:Card', dependencies: [] }],
    themes: { names: ['light'], namesSource: 'fallback' },
    classes: { input: 2, matched: 1, unmatched: [{ className: 'no-such-rule', sources: ['safelist:@x/kit:Card'] }], safelistRedundant: [] },
    tokens: { undefined: [] },
    prune: null,
    sizesSource: 'emission',
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

  /**
   * `--allow` — записанный долг. Без такого шва потребитель заводит вокруг
   * доктора свой скрипт, который фильтрует коды сам, и тот неизбежно расходится
   * с доктором: на дизайн-системе так и было.
   */
  it('doctor: --allow снимает код с гейта, но не с отчёта', async () => {
    const root = appDir()
    const allowed = io(root)
    expect(await runGranumCli(['doctor', 'granum.config.mjs', '--strict', '--allow=safelist-dead'], allowed.io)).toBe(0)
    // Находка всё равно напечатана: разрешение не прячет её, а только не роняет гейт.
    expect(allowed.out[0]).toContain('[safelist-dead] @x/kit:Card')

    const other = io(root)
    expect(await runGranumCli(['doctor', 'granum.config.mjs', '--strict', '--allow=token-undefined'], other.io)).toBe(1)
    expect(other.err.join('\n')).toContain('1 × safelist-dead')
  })

  it('doctor: --code и --component печатают детали, --components разворачивает список', async () => {
    const root = appDir()
    const byCode = io(root)
    expect(await runGranumCli(['doctor', 'granum.config.mjs', '--code=safelist-dead'], byCode.io)).toBe(0)
    expect(byCode.out[0]).toContain('Diagnostics for code safelist-dead')

    const byComponent = io(root)
    expect(await runGranumCli(['doctor', 'granum.config.mjs', '--component=@x/kit:Card'], byComponent.io)).toBe(0)
    expect(byComponent.out[0]).toContain('Diagnostics for component @x/kit:Card')

    const expanded = io(root)
    expect(await runGranumCli(['doctor', 'granum.config.mjs', '--components'], expanded.io)).toBe(0)
    expect(expanded.out[0]).toContain('• @x/kit:Card —')
  })

  /**
   * `audit` работает по СОБРАННОМУ дистрибутиву и конфига не требует вовсе:
   * селекцию и список провайдеров он берёт из отчёта сборки, состав компонентов —
   * из манифестов. Поэтому его можно поставить в прогон чужого репозитория.
   */
  it('audit: по dist без конфига; недоставленный CSS роняет код возврата', async () => {
    const root = appDir()
    // В `dist` приложения нет ни CSS, ни JS: ни класса выбранного компонента,
    // ни его собственного правила там нет — это дефект доставки.
    const failing = io(root)
    expect(await runGranumCli(['audit', 'dist'], failing.io)).toBe(1)
    expect(failing.out[0]).toContain('granum audit')
    expect(failing.out[0]).toContain('@x/kit:Card: classes missing from the CSS (p-4)')
    expect(failing.out[0]).toContain('@x/kit:Card: own rules missing from the CSS (card)')
    // Мёртвая запись safelist — находка отчёта: её называет `doctor`, а аудит
    // доводит до кода возврата только со `--strict` (D-9).
    expect(failing.out[0]).not.toContain('classes with no engine rule')

    const strict = io(root)
    expect(await runGranumCli(['audit', 'dist', '--strict'], strict.io)).toBe(1)
    expect(strict.out[0]).toContain('classes with no engine rule: no-such-rule')

    const json = io(root)
    expect(await runGranumCli(['--json', 'audit', 'dist'], json.io)).toBe(1)
    const report = JSON.parse(json.out[0]!)
    expect(report.ok).toBe(false)
    expect(report.selection).toEqual(['@x/kit:Card'])
    expect(report.providers[0].id).toBe('@x/kit')
  })

  it('audit: нет отчёта сборки — код 1 и внятное сообщение, а не догадки', async () => {
    const root = appDir()
    const t = io(root)
    expect(await runGranumCli(['audit', 'node_modules'], t.io)).toBe(1)
    expect(t.err.join('\n')).toContain('no \'granum-report.json\'')
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
    const root = appDir({ config: `import { engine } from './granum.engine.mjs'\nexport default { providers: ['@x/kit'], engine: engine(), components: ['@x/kit:Card'], themes: { tokenOverrides: { light: { extra: '1' } } } }\n` })
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

/** Пакет-провайдер с размеченными реестрами — как в codegen.test.ts. */
function providerDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'granum-cli-codegen-'))
  const component = (name: string) => {
    mkdirSync(join(root, 'src/components', name), { recursive: true })
    writeFileSync(join(root, 'src/components', name, 'index.ts'), 'export {}\n')
    writeFileSync(join(root, 'src/components', name, 'config.ts'), `export const ${name[0]!.toLowerCase()}${name.slice(1)}Config = defineGranumComponent(import.meta.url, { name: '${name}' })\n`)
  }
  component('GrAlert')
  component('GrTabs')
  mkdirSync(join(root, 'src/granum-provider'), { recursive: true })
  writeFileSync(join(root, 'src/index.ts'), '// <granum:components>\n// </granum:components>\n')
  writeFileSync(join(root, 'src/granum-provider/index.ts'), '// <granum:components:imports>\n// </granum:components:imports>\nexport const provider = defineGranumProvider({\n  components: [\n    // <granum:components:registry>\n    // </granum:components:registry>\n  ],\n})\n')
  // Один subpath компонента обязан быть: по нему генератор находит место ряда.
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: '@acme/kit', exports: { '.': { import: './dist/index.js' }, './components/GrOld': { import: './dist/components/GrOld/index.js' } } }, null, 2)}\n`)
  return root
}

describe('granum codegen', () => {
  it('генерирует barrel, exports с манифестом и реестр; --check после — чисто', async () => {
    const root = providerDir()
    const t = io(root)
    expect(await runGranumCli(['codegen'], t.io), t.err.join('\n')).toBe(0)
    expect(t.out[0]).toContain('Components (2): GrAlert, GrTabs')
    expect(t.out[0]).toContain('Written (3)')
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toContain(`export * from './components/GrAlert'`)
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(Object.keys(pkg.exports)).toEqual(['.', './granum.manifest.json', './components/GrAlert', './components/GrTabs'])
    expect(pkg.exports['./components/GrOld']).toBeUndefined()
    expect(readFileSync(join(root, 'src/granum-provider/index.ts'), 'utf8')).toContain('grTabsConfig,')
    const check = io(root)
    expect(await runGranumCli(['codegen', '.', '--check', '--json'], check.io), check.err.join('\n')).toBe(0)
    expect(JSON.parse(check.out[0]!).stale).toEqual([])
  })

  it('--check при устаревших реестрах — код 1 со списком файлов; --targets ограничивает цели', async () => {
    const root = providerDir()
    expect(await runGranumCli(['codegen', root, '--targets=barrel'], io('/').io)).toBe(0)
    const check = io(root)
    expect(await runGranumCli(['codegen', '--check'], check.io)).toBe(1)
    expect(check.out[0]).toContain('Out of date (2): package.json, src/granum-provider/index.ts')
    const bad = io(root)
    expect(await runGranumCli(['codegen', '--targets=barrel,nope'], bad.io)).toBe(2)
    expect(bad.err[0]).toContain('unknown target')
  })

  it('ошибка генерации (нет exports) — код 1 с сообщением', async () => {
    const root = providerDir()
    writeFileSync(join(root, 'package.json'), '{ "name": "@acme/kit" }\n')
    const t = io(root)
    expect(await runGranumCli(['codegen', '--targets=manifest'], t.io)).toBe(1)
    expect(t.err[0]).toContain('[granum]')
    expect(t.err[0]).toContain('exports')
  })
})

describe('loadGranumConfigFile', () => {
  it('принимает default, granum и config; проверяет форму конфига', async () => {
    const root = appDir({ config: `import { engine } from './granum.engine.mjs'\nexport const granum = { providers: ['@x/kit'], engine: engine() }\n` })
    const loaded = await loadGranumConfigFile('granum.config.mjs', root)
    expect(loaded.root).toBe(root)
    expect(loaded.config.providers).toEqual(['@x/kit'])
    writeFileSync(join(root, 'bad.config.mjs'), 'export const config = { providers: "nope" }\n')
    await expect(loadGranumConfigFile('bad.config.mjs', root)).rejects.toBeInstanceOf(ConfigLoadError)
  })

  it('ts-конфиг без vite в корне грузится нативно', async () => {
    const root = appDir()
    writeFileSync(join(root, 'granum.config.ts'), `import { engine } from './granum.engine.mjs'\nconst providers: string[] = ['@x/kit']\nexport default { providers, engine: engine() }\n`)
    const loaded = await loadGranumConfigFile('granum.config.ts', root)
    expect(loaded.config.providers).toEqual(['@x/kit'])
  })
})
