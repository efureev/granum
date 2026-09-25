import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Токены тем объявлены ссылками на CSS: сборка провайдера читает их и кладёт
 * значения в манифест (C-13). Обе формы ссылки — строка и объект.
 */
export const xTokenizedConfig = defineGranumComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitionsRef: {
    light: './themes/light.css',
    dark: { url: './themes/dark.css', as: '.dark, [data-theme="dark"]' },
  },
})
