import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Форма `package.json` пакета движка — часть контракта пары «ядро + движок».
 *
 * Ядро приходит peer-зависимостью и только ею: если оно окажется в
 * `dependencies`, у приложения в графе появятся две копии `@feugene/granum`, и
 * хелперы отпечатка словаря в них будут разные. Тогда отпечатки перестанут
 * сравниваться, granum начнёт пересчитывать классы всех пакетов на каждой
 * сборке и никто этого не заметит — кроме времени сборки.
 */
interface PackageJson {
  name: string
  version: string
  type: string
  sideEffects: boolean
  engines: { node: string }
  exports: Record<string, unknown>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  files: string[]
}

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as PackageJson

describe('package.json пакета движка', () => {
  it('ядро — единственная зависимость, и она peer', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([])
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual(['@feugene/granum'])
  })

  it('одна точка входа, ESM, без побочных эффектов', () => {
    expect(pkg.type).toBe('module')
    expect(pkg.sideEffects).toBe(false)
    expect(Object.keys(pkg.exports).sort()).toEqual(['.', './package.json'])
  })

  it('в пакет уезжают dist, лицензия и уведомление об авторстве апстрима (ADR-2)', () => {
    for (const entry of ['dist', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
      expect(pkg.files).toContain(entry)
  })

  it('диапазон peer покрывает собственную версию: пара выпускается одним тегом', () => {
    const peer = pkg.peerDependencies!['@feugene/granum']!
    const [major, minor] = pkg.version.split('.')
    expect(peer).toBe(`^${major}.${minor}.0`)
  })
})
