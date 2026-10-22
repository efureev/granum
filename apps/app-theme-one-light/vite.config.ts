import { granum } from '@feugene/granum/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import config from './granum.config.ts'

export default defineConfig({
  base: '/app-theme-one-light/',
  plugins: [vue(), granum(config)],
})
