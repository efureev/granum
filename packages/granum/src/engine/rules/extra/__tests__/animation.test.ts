import { describe, expect, it } from 'vitest'
import { createGenerator } from '../../../vendor/core/index.js'

import { animationPreflights, animationRules } from '../index'

describe('animationRules / animationPreflights', () => {
  it('animate-spin эмитит правило и отдельный @keyframes из preflight', async () => {
    const uno = await createGenerator({ rules: animationRules, preflights: animationPreflights })
    const { css } = await uno.generate('animate-spin')
    expect(css).toContain('animation:granularity-spin 1s linear infinite')
    expect(css).toContain('@keyframes granularity-spin')
  })
})
