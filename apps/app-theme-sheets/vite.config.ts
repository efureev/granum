import { fileURLToPath, URL } from 'node:url'
import { granum } from '@feugene/granum/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import config from './granum.config.ts'

// Две страницы: лист `ink` модулем получает только `previews.html`.
export default defineConfig({
  base: '/app-theme-sheets/',
  plugins: [vue(), granum(config)],
  build: {
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        previews: fileURLToPath(new URL('./previews.html', import.meta.url)),
      },
    },
  },
})
