import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Стенд разделения CSS по слоям (`css.split`, A-21).
 *
 * Набор намеренно совпадает с `bench-one`: тот же компонент, те же две темы, тот
 * же фундамент. Отличие ровно одно — `css.split: true`, — и поэтому разницу в
 * дистрибутиве можно приписать опции, а не составу.
 *
 * Разметка приложения здесь СВОИ утилиты имеет (в отличие от `bench-one`, где их
 * нет намеренно): без них правка `App.vue` не меняла бы слой `utilities`, и
 * стенд не мог бы показать, что меняется один ассет из пяти.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/heavy'],
  components: ['@granum-fixtures/heavy:XhPanel'],
  themes: { names: ['light', 'dark'] },
  appSources: { dirs: ['src'] },
  css: { split: true },
})
