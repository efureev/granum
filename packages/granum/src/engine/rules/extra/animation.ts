import type { Preflight, Rule } from '../../vendor/core/index.js'

export const animationRules: Rule[] = [
  [
    /^animate-spin$/,
    () => ({
      animation: 'granularity-spin 1s linear infinite',
    }),
  ],
]

export const animationPreflights: Preflight[] = [
  {
    getCSS: () => '@keyframes granularity-spin{to{transform:rotate(360deg)}}',
  },
]
