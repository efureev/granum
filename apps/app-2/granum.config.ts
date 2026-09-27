import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Компонент, все классы которого собираются в JS в рантайме: в манифесте они
 * лежат в `safelist` (C-8). Значения токенов, которые компонент потребляет,
 * задаёт само приложение через `themes.tokenOverrides` — без структурных
 * слоёв провайдера.
 *
 * Заодно стенд ветки «диалект тот же, отпечаток другой» (таблица §8 ТЗ
 * движка): правило приложения расширяет словарь, отпечаток движка расходится с
 * записанным в манифесте, и granum пересчитывает классы пакета своим движком
 * вместо того, чтобы поверить списку. Наборы обязаны совпасть — пакет собран
 * тем же preset-mini, — и расхождение здесь означало бы дефект пересчёта.
 */
export default defineGranumConfig({
  engine: windEngine({ rules: [['x-app-only', { 'outline-style': 'dotted' }]] }),
  providers: ['@granum-fixtures/simple'],
  components: [{ provider: '@granum-fixtures/simple', names: ['XTestStyled'] }],
  themes: {
    tokenOverrides: {
      light: { 'brd': '#02f8fa', 'card-fg': '#af172a' },
    },
  },
  appSources: { dirs: ['src'] },
})
