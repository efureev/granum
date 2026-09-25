import { describe, expect, it } from 'vitest'
import { CLI_COMMANDS, runGranumCli, USAGE } from '../cli'

function io(): { out: string[], err: string[], io: { stdout: (l: string) => void, stderr: (l: string) => void } } {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { stdout: l => out.push(l), stderr: l => err.push(l) } }
}

describe('granum cli shell', () => {
  it('prints usage and exits 0 without arguments, --help and -h', () => {
    for (const argv of [[], ['--help'], ['-h']]) {
      const t = io()
      expect(runGranumCli(argv, t.io)).toBe(0)
      expect(t.out).toEqual([USAGE])
      expect(t.err).toEqual([])
    }
  })

  it('prints the version', () => {
    const t = io()
    expect(runGranumCli(['--version'], t.io)).toBe(0)
    expect(t.out).toEqual(['0.0.0-test'])
  })

  it('lists every planned command in usage', () => {
    for (const c of CLI_COMMANDS)
      expect(USAGE).toContain(`  ${c}`)
  })

  it('reports planned commands as not implemented with exit code 2', () => {
    for (const c of CLI_COMMANDS) {
      const t = io()
      expect(runGranumCli([c, '--json'], t.io)).toBe(2)
      expect(t.err[0]).toContain(`granum ${c}: not implemented yet`)
    }
  })

  it('rejects unknown commands with exit code 2 and usage on stderr', () => {
    const t = io()
    expect(runGranumCli(['frobnicate'], t.io)).toBe(2)
    expect(t.err[0]).toContain(`unknown command 'frobnicate'`)
    expect(t.err[0]).toContain('usage: granum')
  })
})
