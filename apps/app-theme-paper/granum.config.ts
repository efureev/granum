import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Тема `paper` — тема по умолчанию владельца, которого приложение не
 * перечисляет: его подгружает строковая зависимость `themed-ds` (A-31). В CSS
 * только данные `paper`; токены спутника для `ink` сюда не едут (C-35).
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/themed-ds', '@granum-fixtures/themed-companion'],
  theme: 'paper',
  appSources: { dirs: ['src'] },
})
