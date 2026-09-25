import type { RegistryCodegenResult } from '../codegen/runRegistryCodegen'
/**
 * `granum codegen [<package-dir>]` (B-14, ТЗ §15.3): стандартные цели
 * генерации реестров провайдера из командной строки — без собственного
 * скрипта у пакета. Нестандартные цели (`markedBlock`) остаются программному
 * API `./codegen`.
 */
import type { GranumCodegenTarget } from '../codegen/targets'
import { runRegistryCodegen } from '../codegen/runRegistryCodegen'
import { barrel, manifestExport, packageExports, providerRegistry } from '../codegen/targets'

export const CODEGEN_TARGET_NAMES = ['barrel', 'exports', 'manifest', 'registry'] as const
export type CodegenTargetName = typeof CODEGEN_TARGET_NAMES[number]

export interface CodegenCommandOptions {
  readonly packageDir: string
  readonly targets?: readonly CodegenTargetName[]
  readonly check?: boolean
  readonly prefix?: string
  readonly componentsDir?: string
  readonly barrelFile?: string
  readonly registryFile?: string
  /** Алиасы `exports` на подкомпоненты составных компонентов. По умолчанию `false`. */
  readonly subcomponents?: boolean
  /** Форма значения subpath-экспорта: объект `types` + `import` или строка `import`. */
  readonly exportsStyle?: 'object' | 'import'
}

export interface CodegenCommandReport extends RegistryCodegenResult {
  readonly packageDir: string
  readonly targets: readonly CodegenTargetName[]
  readonly check: boolean
}

/** Разбор `--targets=barrel,exports`; неизвестное имя — `undefined` (неверный вызов). */
export function parseCodegenTargets(value: string | undefined): CodegenTargetName[] | undefined {
  if (value === undefined)
    return [...CODEGEN_TARGET_NAMES]
  const names = value.split(',').map(s => s.trim()).filter(Boolean)
  if (names.length === 0 || names.some(n => !(CODEGEN_TARGET_NAMES as readonly string[]).includes(n)))
    return undefined
  return [...new Set(names)] as CodegenTargetName[]
}

export function buildCodegenTargets(options: CodegenCommandOptions): GranumCodegenTarget[] {
  const out: GranumCodegenTarget[] = []
  for (const name of options.targets ?? CODEGEN_TARGET_NAMES) {
    switch (name) {
      case 'barrel':
        out.push(barrel(options.barrelFile))
        break
      case 'exports':
        out.push(packageExports({ ...(options.subcomponents ? { subcomponents: true } : {}), ...(options.exportsStyle ? { entryStyle: options.exportsStyle } : {}) }))
        break
      case 'manifest':
        out.push(manifestExport())
        break
      case 'registry':
        out.push(...providerRegistry(options.registryFile))
        break
    }
  }
  return out
}

export async function runCodegenCommand(options: CodegenCommandOptions): Promise<CodegenCommandReport> {
  const targets = options.targets ?? [...CODEGEN_TARGET_NAMES]
  const result = await runRegistryCodegen({
    packageDir: options.packageDir,
    targets: buildCodegenTargets({ ...options, targets }),
    check: options.check ?? false,
    ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
    ...(options.componentsDir !== undefined ? { componentsDir: options.componentsDir } : {}),
  })
  return { ...result, packageDir: options.packageDir, targets, check: options.check ?? false }
}

export function formatCodegenReport(report: CodegenCommandReport, cwd: string): string {
  const rel = (file: string): string => (file.startsWith(cwd) ? file.slice(cwd.length + 1) : file)
  const lines: string[] = []
  lines.push(`granum codegen${report.check ? ' --check' : ''}`)
  lines.push('='.repeat(lines[0]!.length))
  lines.push('')
  lines.push(`Package: ${rel(report.packageDir) || '.'}`)
  lines.push(`Targets: ${report.targets.join(', ')}`)
  lines.push(`Components (${report.components.length}): ${report.components.join(', ') || '—'}`)
  lines.push('')
  if (report.check) {
    lines.push(report.stale.length
      ? `✗ Out of date (${report.stale.length}): ${report.stale.join(', ')} — run granum codegen without --check.`
      : '✓ Registries are up to date.')
  }
  else {
    lines.push(report.written.length
      ? `✓ Written (${report.written.length}): ${report.written.join(', ')}`
      : '✓ Nothing to change — registries were already up to date.')
  }
  return lines.join('\n')
}
