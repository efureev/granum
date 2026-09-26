import { defineGranumConfig } from '@feugene/granum/vite'
import { miniEngine } from '@feugene/granum-engine-mini'

/** Две темы провайдерского компонента; манифест тем уходит рантайму через `virtual:granum/themes`. */
export default defineGranumConfig({
  engine: miniEngine(),
  providers: ['@granum-fixtures/simple'],
  components: ['@granum-fixtures/simple:XTokenized'],
  themes: { names: ['light', 'dark'] },
  appSources: { dirs: ['src'] },
})
