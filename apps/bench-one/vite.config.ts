import type { Plugin } from 'vite'
import process from 'node:process'
import { granum } from '@feugene/granum/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import config from './granum.config.ts'

/**
 * Обвязка совпадает с `bench-zero` во всём, кроме плагина granum и
 * чанк-группы провайдера. CSS granum приезжает одним ассетом `index-*.css`;
 * раскладка по слоям берётся из `granum-report.json` — он считается из той
 * же эмиссии (INV-DIAG-1), поэтому дробить CSS на файлы ради замера незачем.
 */
export const heavyChunkGroup = {
  name: 'hpkg',
  test: /fixtures[\\/]heavy-package[\\/]dist[\\/]/,
  priority: 2,
}
export const vueChunkGroup = {
  name: 'vue',
  test: /node_modules[\\/](?:vue|@vue)[\\/]/,
  priority: 3,
}

/**
 * Сборка без granum (AC-3, `scripts/compare-js.mjs`): плагин заменяется
 * заглушкой, отдающей пустой `virtual:granum.css`. JS-бандл обязан совпасть
 * побайтно — плагин не трогает JS (A-7).
 */
function granumStub(): Plugin {
  return {
    name: 'granum-stub',
    resolveId: id => (id === 'virtual:granum.css' ? '\0granum-stub.css' : null),
    load: id => (id === '\0granum-stub.css' ? '' : null),
  }
}

const withoutGranum = process.env.GRANUM_STUB === '1'

export default defineConfig({
  base: '/bench-one/',
  build: {
    outDir: withoutGranum ? 'dist-nogranum' : 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [heavyChunkGroup, vueChunkGroup] },
      },
    },
  },
  plugins: [vue(), withoutGranum ? granumStub() : granum(config)],
})
