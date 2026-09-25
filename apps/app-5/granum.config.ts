import { defineGranumConfig } from '@feugene/granum/vite'

/** Две темы провайдерского компонента; манифест тем уходит рантайму через `virtual:granum/themes`. */
export default defineGranumConfig({
  providers: ['@granum-fixtures/simple'],
  components: ['@granum-fixtures/simple:XTokenized'],
  themes: { names: ['light', 'dark'] },
  appSources: { dirs: ['src'] },
})
