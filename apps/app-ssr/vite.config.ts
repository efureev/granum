import { fileURLToPath, URL } from 'node:url'
import { granum } from '@feugene/granum/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

import granumConfig from './granum.config'

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  base: '/app-ssr/',
  plugins: [vue(), granum(granumConfig)],
  // Провайдеры — внешние, как пакеты из npm у настоящего приложения: серверный
  // бандл грузит их `dist` из node_modules в рантайме. Пакеты воркспейса Vite
  // иначе встраивает, и стенд не видел бы, что провайдер тянет в Node.
  ssr: { external: ['@granum-fixtures/extra-simple', '@granum-fixtures/simple', '@granum-fixtures/heavy'] },
})
