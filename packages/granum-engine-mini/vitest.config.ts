import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Тесты движка идут против ИСХОДНИКОВ ядра, а не его `dist`: иначе
      // прогон юнитов зависел бы от порядка сборки пакетов. В сборке и в
      // публикации `@feugene/granum` остаётся peer-зависимостью.
      '@feugene/granum/engine': fileURLToPath(new URL('../granum/src/engine/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
})
