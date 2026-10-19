import { granumProvider } from '@feugene/granum/build'
import { windEngine } from '@feugene/granum-engine-wind'
import { defineConfig } from 'vite'
import { themesProvider } from './src/granum-provider/index.ts'

export default defineConfig({
  plugins: [granumProvider({ provider: themesProvider, engine: windEngine() })],
  build: {
    target: 'esnext',
    minify: false,
    emptyOutDir: true,
  },
})
