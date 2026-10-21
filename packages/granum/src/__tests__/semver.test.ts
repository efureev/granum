import reference from 'semver'
import { describe, expect, it } from 'vitest'

import { compareVersions, isValidRange, isVersion, parseVersion, satisfies } from '../core/semver'

const RANGES = [
  '1.2.3',
  '=1.2.3',
  '1.2',
  '1',
  '*',
  'x',
  '',
  '1.x',
  '1.2.x',
  '1.X.x',
  '*.*.*',
  '>1.2.3',
  '>=1.2.3',
  '<1.2.3',
  '<=1.2.3',
  '>1.2',
  '>=1.2',
  '<1.2',
  '<=1.2',
  '>1',
  '<=1',
  '<*',
  '>*',
  '>=*',
  '<=*',
  '~1.2.3',
  '~1.2',
  '~1',
  '~0.2.3',
  '~0.0.1',
  '~1.2.3-beta.2',
  '~ 1.2.3',
  '^1.2.3',
  '^0.2.3',
  '^0.0.3',
  '^1.2.x',
  '^0.0.x',
  '^0.0',
  '^1.x',
  '^0.x',
  '^1.2.3-beta.2',
  '^0.0.3-rc.1',
  '^ 1.2.3',
  '1.2.3 - 2.3.4',
  '1.2 - 2.3.4',
  '1.2.3 - 2.3',
  '1.2.3 - 2',
  '1.2.3-beta - 2.0.0',
  '* - 2',
  '1.2.3 - *',
  '>=1.2.3 <2.0.0',
  '>= 1.2.3 < 2.0.0',
  '>=1.2.3-alpha <1.2.4',
  '^1.0.0 || ^2.0.0',
  '1.x || >=2.5.0 || 5.0.0 - 7.2.3',
  '>=0.0.0',
  '>2.0.0-0',
  '<2.0.0-0',
  '>=3.0.0-next.1 <4.0.0',
  '^10.2.3',
  '~12.0.1',
  '>=10.20.30 <11',
  '10.x',
]

const VERSIONS = [
  '0.0.0',
  '0.0.1',
  '0.0.3',
  '0.0.4',
  '0.1.0',
  '0.2.3',
  '0.2.9',
  '0.3.0',
  '1.0.0',
  '1.2.0',
  '1.2.2',
  '1.2.3',
  '1.2.4',
  '1.3.0',
  '1.9.9',
  '2.0.0',
  '2.3.4',
  '2.3.5',
  '2.4.0',
  '2.5.0',
  '3.0.0',
  '5.0.0',
  '7.2.3',
  '7.2.4',
  '1.2.3-alpha',
  '1.2.3-beta',
  '1.2.3-beta.2',
  '1.2.3-beta.10',
  '1.2.3-rc.1',
  '1.2.4-alpha',
  '2.0.0-0',
  '2.0.0-beta',
  '0.0.3-rc.1',
  '0.0.3-rc.2',
  '3.0.0-next.1',
  '3.0.0-next.2',
  '3.1.0-next.1',
  '10.2.2',
  '10.2.3',
  '10.20.30',
  '10.99.0',
  '11.0.0',
  '12.0.0',
  '12.0.5',
  '12.1.0',
]

describe('semver: подмножество node-semver (C-41)', () => {
  it.each(RANGES)('диапазон %j валиден и совпадает с semver на каждой версии', (range) => {
    expect(isValidRange(range)).toBe(true)
    expect(reference.validRange(range)).not.toBeNull()
    for (const version of VERSIONS)
      expect(satisfies(version, range), `${version} in ${JSON.stringify(range)}`).toBe(reference.satisfies(version, range))
  })

  it('версии сравниваются в порядке semver, включая предрелизы', () => {
    const sorted = [...VERSIONS].sort((a, b) => compareVersions(parseVersion(a)!, parseVersion(b)!))
    expect(sorted).toEqual([...VERSIONS].sort(reference.compare))
  })

  it('версия — MAJOR.MINOR.PATCH с предрелизом, без сборочных метаданных и префиксов', () => {
    for (const version of ['1.2.3', '0.0.0', '1.2.3-beta.2', '10.20.30-rc.1.alpha'])
      expect(isVersion(version), version).toBe(true)
    for (const version of ['1.2', '1', '01.2.3', '1.2.3+build.1', 'v1.2.3', '1.2.3-', '1.2.3-01', '', 'x'])
      expect(isVersion(version), version).toBe(false)
  })

  it('мусор — невалидный диапазон, и ни одна версия под него не подходит', () => {
    for (const range of ['abc', '1.2.3.4', '>=a', '~>1.2', '1.2.3 -', '>=1.2.3 <', '^^1', '1 - 2 - 3']) {
      expect(isValidRange(range), range).toBe(false)
      expect(satisfies('1.2.3', range), range).toBe(false)
    }
  })

  it('число после x или *, пробел внутри оператора и числа сверх безопасных — не диапазоны, как и у semver', () => {
    for (const range of ['1.x.3', '*.2', 'x.1', '1.*.0', '> = 1.2.3', '< = 2', '99999999999999999.0.0', '^9007199254740993']) {
      expect(isValidRange(range), range).toBe(false)
      expect(reference.validRange(range), range).toBeNull()
    }
    expect(isVersion('99999999999999999.0.0')).toBe(false)
  })

  it('сборочные метаданные версии пакета в сверке не участвуют', () => {
    expect(satisfies('2.1.0+sha.5114f85', '^2.0.0')).toBe(reference.satisfies('2.1.0+sha.5114f85', '^2.0.0'))
    expect(satisfies('2.1.0-rc.1+build.7', '>=2.1.0-rc.0 <3')).toBe(true)
    expect(satisfies('3.0.0+sha', '^2.0.0')).toBe(false)
  })
})
