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

export default defineConfig({
  base: '/bench-pruned/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [heavyChunkGroup, vueChunkGroup] },
      },
    },
  },
  plugins: [vue(), granum(config)],
})
