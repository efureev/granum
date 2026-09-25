/**
 * Логика CLI `granum` (ТЗ §12), отделённая от точки входа `bin.ts`, чтобы
 * тестироваться без подпроцесса. Команды появляются на этапе 6; оболочка уже
 * держит контракт кодов выхода (INV-ERR-3): `0` — успех, `2` — ошибка вызова.
 */
import { GRANUM_VERSION } from './version'

export const CLI_COMMANDS = ['doctor', 'explain', 'why-css', 'tokens', 'prune', 'report'] as const
export type CliCommand = typeof CLI_COMMANDS[number]

export interface CliIo {
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
}

export const USAGE = [
  'usage: granum <command> [options]',
  '',
  'commands:',
  ...CLI_COMMANDS.map(c => `  ${c}`),
  '',
  'options:',
  '  --help       show this message',
  '  --version    print version',
].join('\n')

export function runGranumCli(argv: readonly string[], io: CliIo): number {
  const [first] = argv
  if (first === undefined || first === '--help' || first === '-h') {
    io.stdout(USAGE)
    return 0
  }
  if (first === '--version' || first === '-v') {
    io.stdout(GRANUM_VERSION)
    return 0
  }
  if ((CLI_COMMANDS as readonly string[]).includes(first)) {
    io.stderr(`granum ${first}: not implemented yet (planned for stage 6)`)
    return 2
  }
  io.stderr(`granum: unknown command '${first}'\n\n${USAGE}`)
  return 2
}
