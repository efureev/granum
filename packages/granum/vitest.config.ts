import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __GRANUM_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
        // Точка входа CLI: шебанг + вызов `runGranumCli` и `process.exitCode`.
        // Исполняется на импорте, покрывается только запуском подпроцесса.
        'src/bin.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
})
