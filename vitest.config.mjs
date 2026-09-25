import { defineConfig } from 'vitest/config'

/**
 * Тесты корневых скриптов. Пакет тестируется своим конфигом — этот покрывает
 * только `scripts/`: чистые функции проверок, отделённые от чтения `dist`.
 */
export default defineConfig({
  test: {
    include: ['scripts/__tests__/**/*.test.mjs'],
    environment: 'node',
  },
})
