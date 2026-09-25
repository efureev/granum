import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Пакет публикуется ИЗ КОРНЯ каталога (`files: ["dist"]`), поэтому `dist/package.json`
// не генерируется: вложенный манифест с `exports` Node игнорирует, а часть
// бандлеров читает — получая другую карту резолва.

const SHEBANG = '#!/usr/bin/env node'
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

function entry(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url))
}

export default defineConfig({
  define: {
    __GRANUM_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    {
      // Гарантируем шебанг у CLI-энтрипоинта (бандлер может его срезать).
      name: 'granum:bin-shebang',
      apply: 'build',
      generateBundle(_options, bundle) {
        const chunk = bundle['bin.js']
        if (chunk && chunk.type === 'chunk' && !chunk.code.startsWith(SHEBANG))
          chunk.code = `${SHEBANG}\n${chunk.code}`
      },
    },
  ],
  build: {
    target: 'esnext',
    reportCompressedSize: true,
    minify: false,
    lib: {
      // Девять entry: восемь публичных точек входа (ТЗ §4.2) и `bin`.
      entry: {
        index: entry('./src/index.ts'),
        contract: entry('./src/contract/index.ts'),
        engine: entry('./src/engine/index.ts'),
        build: entry('./src/build.ts'),
        vite: entry('./src/vite.ts'),
        node: entry('./src/node.ts'),
        runtime: entry('./src/runtime.ts'),
        codegen: entry('./src/codegen.ts'),
        bin: entry('./src/bin.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      // `node:*` и `vite` — единственное, что остаётся снаружи. Всё остальное
      // обязано быть внутри пакета: внешних зависимостей у него нет (N-1).
      external: [/^node:/, 'vite'],
    },
  },
})
