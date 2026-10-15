import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { windEngine, WIND_DIALECT_EXTRA } from '@feugene/granum-engine-wind'

/**
 * Пакет без компонентов: в манифесте только блок движка. Отпечаток — ванильного
 * движка диалекта, иначе приложение на ванильном `windEngine()` пошло бы
 * медленным путём, ради которого пакет и вынесен.
 */
export default async function ({ manifest, distDir, check }) {
  check(manifest.id === '@granum-fixtures/rules-only', 'id')
  check(Object.keys(manifest.components).length === 0, `компонентов нет: ${Object.keys(manifest.components)}`)
  check(manifest.engine.dialect === WIND_DIALECT_EXTRA, `dialect: ${manifest.engine.dialect}`)
  check(manifest.engine.vocabulary === windEngine().vocabulary, `vocabulary ванильный: ${manifest.engine.vocabulary}`)
  check(manifest.engine.module === 'engine.js', `engine.module: ${manifest.engine.module}`)
  check(manifest.warnings.length === 0, `warnings: ${JSON.stringify(manifest.warnings)}`)

  // Модуль правил самодостаточен: грузится в Node и отдаёт оба правила.
  check(existsSync(join(distDir, 'engine.js')), 'модуль правил собран')
  const rules = (await import(pathToFileURL(join(distDir, 'engine.js')).href)).default.rules
  check(rules.map(rule => String(rule[0])).join(' ') === 'brand-logo /^brand-pad-(\\d+)$/', `правила модуля: ${rules.map(rule => String(rule[0]))}`)
}
