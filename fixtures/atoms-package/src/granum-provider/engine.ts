/**
 * Правила пакета поверх словаря `granum-fixtures/atoms@1` (C-E1). Уезжают в
 * `dist/granum-provider/engine.js` и объявлены в манифесте как `engine.module`:
 * приложение загрузит их только если его движок говорит на том же диалекте
 * (A-E6, INV-ENG-8).
 */
import type { GranumRule } from '@feugene/granum/engine'

export const atomsRules: readonly GranumRule[] = [
  ['atom-frame', { border: '1px solid var(--at-line)' }],
  ['atom-round', { 'border-radius': 'var(--at-radius)' }],
]

export default { rules: atomsRules }
