import { granum } from '@feugene/granum/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import config from './granum.config.ts'

export default defineConfig({
  base: '/app-theme-values-stale/',
  plugins: [vue(), granum(config)],
})
