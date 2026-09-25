import { granumProvider } from '@feugene/granum/build'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { heavyProvider } from './src/granum-provider/index.ts'

export default defineConfig({
  plugins: [vue(), granumProvider({ provider: heavyProvider })],
  build: {
    target: 'esnext',
    minify: false,
    emptyOutDir: true,
    rolldownOptions: { external: ['vue'] },
  },
})
