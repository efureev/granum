import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * `XgQuick` тянет `XTest1` из донора: оба провайдера подключены по имени
 * пакета, зависимость компонента объявлена в манифесте (C-9).
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/extra-simple', '@granum-fixtures/simple'],
  components: [{ provider: '@granum-fixtures/extra-simple', names: ['XgQuick'] }],
  appSources: { dirs: ['src'] },
})
