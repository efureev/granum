/**
 * Архитектурные проверки по исходникам (INV-DIAG-1, INV-RES-3): эффективное
 * значение токена вычисляется в одном месте — `core/tokenLayers.ts`; эмиссия,
 * отчёт и CLI только читают готовые цепочки резолюции и никогда не выводят
 * значение из слоёв заново.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === 'vendor' || name === '__tests__' || name === '__snapshots__')
        continue
      out.push(...sources(path))
    }
    else if (/\.ts$/.test(name)) {
      out.push(path)
    }
  }
  return out.sort()
}

const OWNER = 'core/tokenLayers.ts'
/** Модули, которым разрешено смотреть на слои цепочки (только для показа, не для вычисления). */
const LAYER_VIEWERS = new Set([OWNER, 'node/diagnostics/tokens.ts', 'node/diagnostics/doctor.ts'])

describe('архитектура: одно место вычисления значений токенов', () => {
  const files = sources(SRC).map(path => ({ rel: relative(SRC, path), code: readFileSync(path, 'utf8') }))

  it('поле effective записывает только core/tokenLayers.ts', () => {
    // Строки с чтением `.effective` отбрасываем: копирование готового значения в отчёт — не вычисление.
    const writers = files
      .filter(f => f.rel !== OWNER)
      .filter(f => f.code.split('\n').filter(line => !line.includes('.effective') && !/readonly effective/.test(line)).some(line => /\beffective\s*[:=](?!=)/.test(line)))
      .map(f => f.rel)
    expect(writers).toEqual([])
  })

  it('никто, кроме владельца, не выводит значение из слоёв цепочки', () => {
    const offenders = files
      .filter(f => !LAYER_VIEWERS.has(f.rel))
      .filter(f => /\.layers\b[^\n]*\.value\b|layers\[[^\]]*\]\s*\.value|layers\.at\(/.test(f.code))
      .map(f => f.rel)
    expect(offenders).toEqual([])
  })

  it('потребители значений читают tokenLayers резолюции, а не пересчитывают темы', () => {
    const consumers = ['node/emit.ts', 'node/themeManifest.ts', 'node/tokenPrune.ts', 'node/diagnostics/doctor.ts', 'node/diagnostics/explain.ts', 'node/diagnostics/tokens.ts']
    for (const rel of consumers) {
      const file = files.find(f => f.rel === rel)!
      expect(file, rel).toBeDefined()
      expect(file.code, rel).toMatch(/tokenLayers/)
      expect(file.code, rel).not.toMatch(/collectTokenLayers|resolveThemes\(/)
    }
    // Единственный вызов расчёта слоёв — из резолвера.
    const callers = files.filter(f => f.rel !== OWNER && /collectTokenLayers\(/.test(f.code)).map(f => f.rel)
    expect(callers).toEqual(['core/resolve.ts'])
  })
})
