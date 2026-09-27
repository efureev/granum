import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Пакет публикуется из корня каталога (`files: ["dist"]`), поэтому
// `dist/package.json` не порождается — как и у ядра.

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  define: {
    __GRANUM_ENGINE_MINI_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'esnext',
    reportCompressedSize: true,
    minify: false,
    lib: {
      entry: { index: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      // Ядро granum — peer: хелперы отпечатка и экстрактор приходят оттуда, и
      // дублировать их в бандле движка нельзя (иначе у приложения окажутся две
      // реализации одного контракта).
      external: [/^node:/, /^@feugene\/granum(?:\/|$)/],
    },
  },
})
