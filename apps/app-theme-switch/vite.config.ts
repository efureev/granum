import { granum } from '@feugene/granum/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import config from './granum.config.ts'

export default defineConfig({
  base: '/app-theme-switch/',
  // `themeScript` ставит в `<head>` скрипт до первого кадра: сохранённая тема и
  // режим — на корне раньше, чем страница нарисуется, лист дополнительной темы —
  // ссылкой до пары. Без него страница мигнула бы основной темой.
  plugins: [vue(), granum(config, { themeScript: true })],
})
