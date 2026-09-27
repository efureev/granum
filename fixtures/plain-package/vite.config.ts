import { granumProvider } from '@feugene/granum/build'
import { windEngine } from '@feugene/granum-engine-wind'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { plainProvider } from './src/granum-provider/index.ts'

export default defineConfig({
  plugins: [
    vue(),
    // Движок сборке нужен всё равно — он раскрывает `@apply` и фильтрует
    // кандидатов, — но ни один класс пакета не принадлежит его словарю. Поэтому
    // в манифест уезжает `dialect: null`: артефакт ни от какого словаря не
    // зависит, и приложение прочитает его любым движком (E-3, M-E5).
    granumProvider({ provider: plainProvider, engine: windEngine() }),
  ],
  build: {
    target: 'esnext',
    minify: false,
    emptyOutDir: true,
    rolldownOptions: { external: ['vue'] },
  },
})
