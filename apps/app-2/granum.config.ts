import { defineGranumConfig } from '@feugene/granum/vite'

/**
 * Компонент, все классы которого собираются в JS в рантайме: в манифесте они
 * лежат в `safelist` (C-8). Значения токенов, которые компонент потребляет,
 * задаёт само приложение через `themes.tokenOverrides` — без структурных
 * слоёв провайдера.
 */
export default defineGranumConfig({
  providers: ['@granum-fixtures/simple'],
  components: [{ provider: '@granum-fixtures/simple', names: ['XTestStyled'] }],
  themes: {
    tokenOverrides: {
      light: { 'brd': '#02f8fa', 'card-fg': '#af172a' },
    },
  },
  appSources: { dirs: ['src'] },
})
