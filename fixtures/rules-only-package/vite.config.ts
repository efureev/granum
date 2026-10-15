import { granumProvider } from '@feugene/granum/build'
import { windEngine } from '@feugene/granum-engine-wind'
import { defineConfig } from 'vite'
import { rulesOnlyProvider } from './src/granum-provider.ts'

export default defineConfig({
  plugins: [
    granumProvider({
      provider: rulesOnlyProvider,
      // Ванильный движок диалекта, без правил пакета: отпечаток в манифесте равен
      // отпечатку ванильного движка приложения, и оно идёт быстрым путём.
      engine: windEngine(),
      // Корневого barrel нет — компонентов нет. Модуль правил — отдельный entry.
      indexEntry: false,
      entries: { engine: 'src/engine.ts' },
      engineModule: 'engine.js',
    }),
  ],
  build: {
    target: 'esnext',
    minify: false,
    emptyOutDir: true,
  },
})
