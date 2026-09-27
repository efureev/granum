import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/** Минимум: один компонент провайдера, классы из манифеста, утилиты приложения. */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/simple'],
  components: ['@granum-fixtures/simple:XTest1'],
  appSources: { dirs: ['src'] },
})
