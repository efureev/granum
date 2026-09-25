import { defineGranumConfig } from '@feugene/granum/vite'

/** Минимум: один компонент провайдера, классы из манифеста, утилиты приложения. */
export default defineGranumConfig({
  providers: ['@granum-fixtures/simple'],
  components: ['@granum-fixtures/simple:XTest1'],
  appSources: { dirs: ['src'] },
})
