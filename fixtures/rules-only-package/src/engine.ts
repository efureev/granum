/**
 * Правила бренда поверх словаря wind. Уезжают отдельным модулем `dist/engine.js`:
 * функции в JSON манифеста не кладут, а приложение загрузит модуль, только если
 * его движок говорит на том же диалекте.
 *
 * Данные правил — из своего JSON: сборка пакета встраивает его в модуль, и
 * приложению читать файлы пакета не нужно.
 */
import type { GranumRule } from '@feugene/granum/engine'
import palette from './palette.json' with { type: 'json' }

export const brandRules: readonly GranumRule[] = [
  ['brand-logo', { 'background-color': palette.brand, 'color': palette.onBrand, 'border-radius': '9999px' }],
  [/^brand-pad-(\d+)$/, ([, step]) => ({ padding: `${Number(step) * 4}px` })],
]

export default { rules: brandRules }
