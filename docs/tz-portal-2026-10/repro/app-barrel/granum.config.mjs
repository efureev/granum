import { windEngine } from '@feugene/granum-engine-wind'
import { defineGranumConfig } from '@feugene/granum/vite'

const mode = process.env.MODE ?? 'list'
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@feugene/granularity'],
  components: mode === 'imports' ? 'imports' : [{ provider: '@feugene/granularity', names: ['GrButton'] }],
  themes: { names: ['light', 'dark'] },
  appSources: { dirs: ['src'] },
})
