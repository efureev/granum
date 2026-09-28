import { describe, expect, it } from 'vitest'
import { median, parseGranumTime, spread, strictBuildCheck, workFacts } from '../lib/buildTime.mjs'

describe('buildTime', () => {
  it('медиана устойчива к одному выбросу, среднее — нет', () => {
    expect(median([10, 12, 400])).toBe(12)
    expect(median([10, 20])).toBe(15)
    expect(median([])).toBe(0)
    // Разброс печатается рядом с числами: замер с разбросом в разы читать нельзя.
    expect(spread([10, 12, 14])).toBeCloseTo(4 / 12, 5)
    expect(spread([])).toBe(0)
  })

  it('строка фаз разбирается из лога сборки, чужие строки не мешают', () => {
    const stdout = 'vite v8.3.1 building...\n[granum] 5 components, 28 classes matched\n[granum] time 76 ms (prepare 3, emit 35, report 38)\n✓ built\n'

    expect(parseGranumTime(stdout)).toEqual({ total: 76, prepare: 3, emit: 35, report: 38 })
    // Сборка без granum строки не печатает, и это не ошибка замера.
    expect(parseGranumTime('vite v8.3.1 building...\n✓ built\n')).toBeNull()
  })

  it('факты о работе берутся из отчёта, а не из замера', () => {
    const report = {
      providers: [
        { id: '@x/kit', reason: 'none', classes: 'manifest' },
        { id: '@x/other', reason: 'dialect', classes: 're-extracted' },
      ],
      classes: { input: 66, matched: 28 },
      selection: [{ key: '@x/kit:Card' }, { key: '@x/kit:Panel' }],
    }

    expect(workFacts(report)).toEqual({
      providers: 2,
      reextract: ['dialect', 'none'],
      classSources: ['manifest', 're-extracted'],
      classesInput: 66,
      classesMatched: 28,
      selection: 2,
    })
  })

  it('сверка идёт в обе стороны: и рост работы, и её исчезновение — расхождение', () => {
    const report = {
      work: { providers: 1, reextract: ['none'], classSources: ['manifest'], classesInput: 66, classesMatched: 28, selection: 5 },
      time: { granumShare: 0.12 },
    }
    const expected = {
      work: { providers: 1, reextract: ['none'], classesInput: 66 },
      time: { maxGranumShare: 0.35 },
    }
    expect(strictBuildCheck(expected, report).every(c => c.ok)).toBe(true)

    // Включился пересчёт классов — самый дорогой путь granum.
    const slow = { ...report, work: { ...report.work, reextract: ['vocabulary'] } }
    expect(strictBuildCheck(expected, slow).find(c => c.name === 'work.reextract')?.ok).toBe(false)

    // Классов на входе генератора стало вдвое больше: работа выросла молча.
    const grown = { ...report, work: { ...report.work, classesInput: 132 } }
    expect(strictBuildCheck(expected, grown).find(c => c.name === 'work.classesInput')?.ok).toBe(false)

    // Доля granum — единственная проверка со временем, и та относительная.
    const hog = { ...report, time: { granumShare: 0.61 } }
    expect(strictBuildCheck(expected, hog).find(c => c.name === 'time.maxGranumShare')?.ok).toBe(false)
  })
})
