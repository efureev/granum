import { granumProvider } from '@feugene/granum/build'
import { windEngine } from '@feugene/granum-engine-wind'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { extraSimpleProvider } from './src/granum-provider/index.ts'

export default defineConfig({
  plugins: [vue(), granumProvider({ provider: extraSimpleProvider, engine: windEngine() })],
  build: {
    target: 'esnext',
    minify: false,
    emptyOutDir: true,
    rolldownOptions: { external: ['vue', /^@granum-fixtures\//] },
  },
})
