import type { GranumBuildReport } from './node/report'
/**
 * Логика CLI `granum` (ТЗ §12), отделённая от `bin.ts`. Коды выхода
 * (INV-ERR-3): `0` — чисто; `1` — нарушения (`error`, с `--strict` и `warn`)
 * или ошибка выполнения; `2` — неверный вызов.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { formatCodegenReport, parseCodegenTargets, runCodegenCommand } from './cli/codegen'
import { loadGranumConfigFile } from './cli/loadConfig'
import { formatDoctorReport, formatExplainReport, formatTokenPruneReport, formatTokensReport, formatWhyCssReport, granumDoctor, granumExplain, granumTokenPrune, granumTokens, granumWhyCss } from './node/diagnostics/index'
import { prepareApp } from './node/prepare'
import { GRANUM_VERSION } from './version'

export const CLI_COMMANDS = ['doctor', 'explain', 'why-css', 'tokens', 'prune', 'report', 'codegen'] as const
export type CliCommand = typeof CLI_COMMANDS[number]

export interface CliIo {
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
  readonly cwd?: string
}

export const USAGE = `granum — diagnostics for @feugene/granum

usage:
  granum doctor  <config> [--json] [--strict] [--allow=code,code]
                 [--code=<code>] [--component=<providerId:Name>] [--components]
  granum explain <config> <providerId:Component> [--json]
  granum why-css <config> <class> [--json]
  granum tokens  <config> <providerId:Component> [--deep] [--json]
  granum prune   <config> [--json] [--strict]
  granum report  [<report.json>] [--json] [--strict]
  granum codegen [<package-dir>] [--check] [--json] [--targets=barrel,exports,manifest,registry]
                 [--prefix=Gr] [--components-dir=src/components] [--barrel=src/index.ts]
                 [--registry=src/granum-provider/index.ts] [--subcomponents] [--exports=object|import]

  <config> — path to granum.config.{ts,js,mjs} of the application; the
  application root is its directory. All commands work from manifests only,
  without building the application; 'report' reads dist/granum-report.json.
  'codegen' runs in a provider package: it regenerates the barrel, the
  component subpaths and manifest export in package.json and the provider
  registry from src/components (marked blocks <granum:components…>).

flags:
  --json      structured report instead of text
  --strict    doctor: warnings fail; prune: anything removable fails;
              report: unmatched classes or undefined tokens fail
  --allow     doctor: comma-separated codes that --strict tolerates (recorded
              debt); they are still counted and printed
  --code      doctor: print every finding of one code in full, with its lists
  --component doctor: narrow everything down to one component
  --components doctor: expand the list of selected components
  --deep      tokens: include the component's dependencies
  --check     codegen: only compare, exit 1 when registries are out of date
  --help, --version`

interface ParsedArgs {
  command?: string
  positionals: string[]
  flags: Set<string>
  /** Флаги со значением: `--prefix=Gr`. */
  values: Map<string, string>
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Set<string>()
  const values = new Map<string, string>()
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq > 0)
        values.set(arg.slice(0, eq), arg.slice(eq + 1))
      else
        flags.add(arg)
    }
    else {
      positionals.push(arg)
    }
  }
  const command = positionals.shift()
  return { ...(command !== undefined ? { command } : {}), positionals, flags, values }
}

function emit(io: CliIo, json: boolean, report: unknown, text: () => string): void {
  io.stdout(json ? JSON.stringify(report, null, 2) : text())
}

export async function runGranumCli(argv: readonly string[], io: CliIo): Promise<number> {
  const { command, positionals, flags, values } = parseArgs(argv)
  const cwd = io.cwd ?? process.cwd()
  const json = flags.has('--json')

  if (command === '-v' || flags.has('--version')) {
    io.stdout(GRANUM_VERSION)
    return 0
  }
  if (command === undefined || command === '-h' || command === 'help' || flags.has('--help')) {
    io.stdout(USAGE)
    return command === undefined && !flags.has('--help') && argv.length > 0 ? 2 : 0
  }
  if (!(CLI_COMMANDS as readonly string[]).includes(command)) {
    io.stderr(`granum: unknown command '${command}'\n\n${USAGE}`)
    return 2
  }

  try {
    if (command === 'codegen') {
      const targets = parseCodegenTargets(values.get('--targets'))
      if (!targets) {
        io.stderr(`granum codegen: unknown target in '--targets=${values.get('--targets')}' (expected barrel, exports, manifest, registry)\n\n${USAGE}`)
        return 2
      }
      const report = await runCodegenCommand({
        packageDir: resolve(cwd, positionals[0] ?? '.'),
        targets,
        check: flags.has('--check'),
        subcomponents: flags.has('--subcomponents'),
        ...(values.has('--prefix') ? { prefix: values.get('--prefix')! } : {}),
        ...(values.has('--components-dir') ? { componentsDir: values.get('--components-dir')! } : {}),
        ...(values.has('--barrel') ? { barrelFile: values.get('--barrel')! } : {}),
        ...(values.has('--registry') ? { registryFile: values.get('--registry')! } : {}),
        ...(values.get('--exports') === 'import' ? { exportsStyle: 'import' as const } : {}),
      })
      emit(io, json, report, () => formatCodegenReport(report, cwd))
      return report.check && report.stale.length > 0 ? 1 : 0
    }
    if (command === 'report') {
      const file = resolve(cwd, positionals[0] ?? 'dist/granum-report.json')
      const report = JSON.parse(readFileSync(file, 'utf8')) as GranumBuildReport
      emit(io, json, report, () => formatBuildReport(report))
      const bad = report.classes.unmatched.length > 0 || report.tokens.undefined.length > 0
      return flags.has('--strict') && bad ? 1 : 0
    }

    const [configPath, subject] = positionals
    if (!configPath) {
      io.stderr(`granum ${command}: missing <config>\n\n${USAGE}`)
      return 2
    }
    if ((command === 'explain' || command === 'tokens' || command === 'why-css') && !subject) {
      io.stderr(`granum ${command}: missing ${command === 'why-css' ? '<class>' : '<providerId:Component>'}\n\n${USAGE}`)
      return 2
    }
    const loaded = await loadGranumConfigFile(configPath, cwd)
    const app = await prepareApp(loaded.config, loaded.root)

    if (command === 'doctor') {
      const report = await granumDoctor(app)
      emit(io, json, report, () => formatDoctorReport(report, {
        ...(values.has('--code') ? { code: values.get('--code')! } : {}),
        ...(values.has('--component') ? { component: values.get('--component')! } : {}),
        ...(flags.has('--components') ? { components: true } : {}),
      }))
      if (!report.ok)
        return 1
      if (!flags.has('--strict'))
        return 0
      // `--allow` — записанный долг: находки этих кодов считаются и печатаются,
      // но гейт не роняют. Без такого шва потребитель заводит свой скрипт-обёртку
      // вокруг доктора, а он неизбежно расходится с самим доктором.
      const allowed = new Set((values.get('--allow') ?? '').split(',').map(c => c.trim()).filter(Boolean))
      const blocking = report.diagnostics.filter(d => d.level === 'warn' && !allowed.has(d.code))
      if (blocking.length === 0)
        return 0
      const byCode = new Map<string, number>()
      for (const d of blocking)
        byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1)
      io.stderr(`granum doctor --strict: ${blocking.length} blocking warning(s): ${[...byCode].map(([c, n]) => `${n} × ${c}`).join(', ')}`)
      return 1
    }
    if (command === 'explain') {
      const report = granumExplain(app, subject!)
      emit(io, json, report, () => formatExplainReport(report))
      return report.reason === 'unknown' ? 1 : 0
    }
    if (command === 'why-css') {
      const report = await granumWhyCss(app, subject!)
      emit(io, json, report, () => formatWhyCssReport(report))
      return report.found ? 0 : 1
    }
    if (command === 'tokens') {
      const report = granumTokens(app, subject!, flags.has('--deep') ? 'deep' : 'own')
      emit(io, json, report, () => formatTokensReport(report))
      return report.unresolved ? 1 : 0
    }
    const report = await granumTokenPrune(app)
    emit(io, json, report, () => formatTokenPruneReport(report, loaded.root))
    return flags.has('--strict') && report.removed.length > 0 ? 1 : 0
  }
  catch (error) {
    io.stderr(`[granum] ${(error as Error)?.message ?? String(error)}`)
    return 1
  }
}

export function formatBuildReport(report: GranumBuildReport): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)
  push('granum report')
  push('=============')
  push()
  push(`Generated by: ${report.generatedBy}`)
  push(`Selection (${report.selection.length}): ${report.selection.map(s => s.key).join(', ') || '—'}`)
  push(`Themes: [${report.themes.names.join(', ')}] (${report.themes.namesSource})`)
  push(`Classes: ${report.classes.matched} matched of ${report.classes.input} candidates; unmatched with a known source: ${report.classes.unmatched.length}`)
  for (const u of report.classes.unmatched)
    push(`  ✗ ${u.className} ← ${u.sources.join(', ')}`)
  if (report.classes.safelistRedundant.length)
    push(`Safelist covered by static classes: ${report.classes.safelistRedundant.join(' ')}`)
  push(`Undefined tokens: ${report.tokens.undefined.join(' ') || '—'}`)
  if (report.prune)
    push(`Prune (${report.prune.mode}): removable ${report.prune.removable.length}, kept ${report.prune.kept}, dead patterns ${report.prune.deadPatterns.length}`)
  push()
  push(`Sizes (raw / gzip / brotli, ${report.sizesSource === 'bundle' ? 'from the built bundle after minification' : 'from the emission before minification'}):`)
  for (const [name, size] of Object.entries(report.sizes))
    push(`  ${name.padEnd(11)} ${String(size.raw).padStart(8)} ${String(size.gzip).padStart(8)} ${String(size.brotli).padStart(8)}`)
  if (report.warnings.length) {
    push()
    push(`Warnings (${report.warnings.length}):`)
    for (const w of report.warnings)
      push(`  ⚠ ${w}`)
  }
  return lines.join('\n')
}
