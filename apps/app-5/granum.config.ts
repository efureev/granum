import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/** Две темы провайдерского компонента; манифест тем уходит рантайму через `virtual:granum/themes`. */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/simple'],
  components: ['@granum-fixtures/simple:XTokenized'],
  themes: { names: ['light', 'dark'] },
  appSources: { dirs: ['src'] },
})
