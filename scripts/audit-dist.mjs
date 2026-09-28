#!/usr/bin/env node
/**
 * Аудит собранного дистрибутива стенда (D-9, INV-DIST-1) одной функцией на все
 * три сверщика: `verify-app`, `verify-ssr` и `verify-split`.
 *
 * Зачем он рядом с `expected.mjs`, который и так сверяет CSS: `expected`
 * перечисляет подстроки, которые автор стенда додумался проверить, а аудит
 * сверяет весь состав манифестов со всем дистрибутивом. Поэтому он замечает то,
 * чего никто не объявлял: класс невыбранного компонента, потерянное правило,
 * недостижимый токен.
 *
 * Гейт строгий: находок не должно быть ни одной. Законные находки отчёта
 * (мёртвая запись safelist фикстуры, чужой диалект) аудит без `--strict` не
 * считает — их поимённо объявляет `expected.doctor`.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'

/**
 * @param {string} dir каталог стенда
 * @param {string[]} args аргументы `granum audit` (по умолчанию `dist`)
 * @returns {string | null} текст находок или `null`, если чисто
 */
export function auditFailure(dir, args = ['dist']) {
  const bin = createRequire(join(dir, 'package.json'))
    .resolve('@feugene/granum/package.json')
    .replace(/package\.json$/, 'dist/bin.js')
  const audit = spawnSync(process.execPath, [bin, 'audit', ...args], { cwd: dir, encoding: 'utf8' })
  if (audit.status === 0)
    return null
  const found = (audit.stdout || '').split('\n').filter(line => line.startsWith('  - ')).join('\n  ')
  return `granum audit завершился кодом ${audit.status}:\n  ${found || audit.stderr}`
}
