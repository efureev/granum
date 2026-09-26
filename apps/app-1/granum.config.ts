import { defineGranumConfig } from '@feugene/granum/vite'
import { miniEngine } from '@feugene/granum-engine-mini'

/** Минимум: один компонент провайдера, классы из манифеста, утилиты приложения. */
export default defineGranumConfig({
  engine: miniEngine(),
  providers: ['@granum-fixtures/simple'],
  components: ['@granum-fixtures/simple:XTest1'],
  appSources: { dirs: ['src'] },
})
