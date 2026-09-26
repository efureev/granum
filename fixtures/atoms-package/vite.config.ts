import { granumProvider } from '@feugene/granum/build'
import { atomsEngine } from '@granum-engines/atoms'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { atomsRules } from './src/granum-provider/engine.ts'
import { atomsProvider } from './src/granum-provider/index.ts'

export default defineConfig({
  plugins: [
    vue(),
    granumProvider({
      // Пакет собирается движком своего словаря: его диалект и отпечаток
      // уезжают в манифест как факт о списке классов (C-E4, M-E5).
      provider: atomsProvider,
      engine: atomsEngine({ rules: atomsRules }),
      // Правила пакета едут отдельным модулем: в JSON функции не кладут (M-E4).
      engineModule: 'granum-provider/engine.js',
      entries: { 'granum-provider/engine': 'src/granum-provider/engine.ts' },
    }),
  ],
  build: {
    target: 'esnext',
    minify: false,
    emptyOutDir: true,
    rolldownOptions: { external: ['vue'] },
  },
})
