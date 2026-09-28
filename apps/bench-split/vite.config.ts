import { granum } from '@feugene/granum/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import config from './granum.config.ts'

/**
 * Обвязка как у `bench-one`, чтобы сравнение с ним было честным: те же
 * чанк-группы, та же база. `main.ts` импортирует `virtual:granum.css` — при
 * `css.split` модуль пустой, а CSS приезжает пятью ассетами со ссылками в HTML.
 */
export default defineConfig({
  base: '/bench-split/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'hpkg', test: /fixtures[\\/]heavy-package[\\/]dist[\\/]/, priority: 2 },
            { name: 'vue', test: /node_modules[\\/](?:vue|@vue)[\\/]/, priority: 3 },
          ],
        },
      },
    },
  },
  plugins: [vue(), granum(config)],
})
