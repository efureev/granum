import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Токены тем объявлены ссылками на CSS: сборка провайдера читает их и кладёт
 * значения в манифест. Обе формы ссылки — строка и объект.
 */
export const xTokenizedConfig = defineGranumComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitionsRef: {
    light: './themes/light.css',
    dark: { url: './themes/dark.css', as: '.dark, [data-theme="dark"]' },
  },
})
