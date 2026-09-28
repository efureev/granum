import { granum } from '@feugene/granum/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import config from './granum.config.ts'

/**
 * Код пакета — отдельной группой: утверждение стенда «в бандле есть один
 * компонент из двух» проверяется по содержимому чанка, и чанк должен быть
 * опознаваемым, а не размазанным по входу.
 */
export const packageChunkGroup = {
  name: 'pkg',
  test: /fixtures[\\/]mini-ds-package[\\/]dist[\\/]/,
  priority: 2,
}
export const vueChunkGroup = {
  name: 'vue',
  test: /node_modules[\\/](?:vue|@vue)[\\/]/,
  priority: 3,
}

export default defineConfig({
  base: '/app-components/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [packageChunkGroup, vueChunkGroup] },
      },
    },
  },
  plugins: [vue(), granum(config)],
})
