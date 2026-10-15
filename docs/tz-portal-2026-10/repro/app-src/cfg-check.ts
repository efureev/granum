import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@feugene/granularity'],
  appSource: { dirs: ['src'] },
  themes: { names: ['light', 'dark'], themeFiles: { dark: './my-dark.css' } },
})
