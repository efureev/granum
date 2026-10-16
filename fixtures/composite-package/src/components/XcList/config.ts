import { defineGranumComponent } from '@feugene/granum/contract'

/** Стили части живут в листе родителя: собственного CSS у `XcListItem` нет. */
export const xcListConfig = defineGranumComponent(import.meta.url, {
  name: 'XcList',
  cssFiles: ['./styles.css'],
})
