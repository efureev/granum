import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * Нулевая отметка замера. Обвязка обязана СОВПАДАТЬ с `bench-one` во всём,
 * кроме плагина granum и чанк-группы провайдера: только тогда разница
 * дистрибутивов — это цена библиотеки, а не разница сборочных настроек.
 */
export const vueChunkGroup = {
  name: 'vue',
  test: /node_modules[\\/](?:vue|@vue)[\\/]/,
  priority: 3,
}

export default defineConfig({
  base: '/bench-zero/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [vueChunkGroup] },
      },
    },
  },
  plugins: [vue()],
})
