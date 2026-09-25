import { defineGranumComponent } from '@feugene/granum/contract'
import { splitClassTokens } from '../../utils/classTokens.ts'
import { base } from './dsStyles.ts'

/** Все классы компонента приходят из строки `base` в рантайме — только safelist (C-8). */
export const xTestStyledConfig = defineGranumComponent(import.meta.url, {
  name: 'XTestStyled',
  safelist: splitClassTokens(base),
})
