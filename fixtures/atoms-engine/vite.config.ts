import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'esnext',
    minify: false,
    emptyOutDir: true,
    lib: {
      entry: { index: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    // Ядро granum — внешнее: движок берёт у него хелперы, а не копирует их.
    rolldownOptions: { external: [/^@feugene\/granum(?:\/|$)/] },
  },
})
