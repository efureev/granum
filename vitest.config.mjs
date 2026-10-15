import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Тесты корневых скриптов. Пакет тестируется своим конфигом — этот покрывает
 * только `scripts/`: чистые функции проверок, отделённые от чтения `dist`.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Скрипты разбирают `dist` той же функцией, что и сам пакет, а их тесты
      // идут против ИСХОДНИКОВ: прогон не зависит от того, собран ли пакет.
      '@feugene/granum/node': fileURLToPath(new URL('./packages/granum/src/node.ts', import.meta.url)),
    },
  },
  test: {
    include: ['scripts/__tests__/**/*.test.mjs'],
    environment: 'node',
  },
})
