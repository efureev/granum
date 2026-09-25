import { granum } from '@feugene/granum/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import config from './granum.config.ts'

/** Код пакета — отдельной группой: так в `dist` видно, что из него доехало. */
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
  base: '/dist-audit/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [packageChunkGroup, vueChunkGroup] },
      },
    },
  },
  plugins: [vue(), granum(config)],
})
