import { defineGranumComponent } from '@feugene/granum/contract'
import { splitClassTokens } from '../../utils/classTokens.ts'
import { BASE_CLASS, PAD_STEP, TONE } from './btnStyles.ts'

/**
 * Классы собираются в рантайме (`p-${n}` и строки тонов) — только safelist (C-8).
 * `shadow-legacy` — намеренный дефект фикстуры: правила у него нет, и отчёт
 * сборки приложения обязан назвать его классом без правила (INV-DIAG-2).
 */
export const xhButtonConfig = defineGranumComponent(import.meta.url, {
  name: 'XhButton',
  safelist: [
    ...splitClassTokens(BASE_CLASS),
    ...Object.values(PAD_STEP).map(step => `p-${step}`),
    ...Object.values(TONE).flatMap(splitClassTokens),
    'shadow-legacy',
  ],
})
