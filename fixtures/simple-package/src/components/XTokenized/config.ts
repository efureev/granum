import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Токены компонента для тем чужих каталогов — `paper` из
 * `@granum-fixtures/themes` и `heavy` из `@granum-fixtures/heavy`: сборка
 * провайдера читает папку и кладёт значения в манифест. Обе формы файла — CSS с
 * одним плоским блоком и JSON.
 */
export const xTokenizedConfig = defineGranumComponent(import.meta.url, {
  name: 'XTokenized',
  themesDir: './themes',
})
