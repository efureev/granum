/**
 * Спецификаторы импортов собранного ES-модуля — для проверки границ `dist`.
 *
 * Разбор — тот же, что у самого пакета (`collectImportSpecifiers` из
 * `@feugene/granum/node`): комментарии срезаются с учётом строк, `require()`
 * считается импортом, спецификатор без пробелов. Своя копия здесь была
 * регэкспом без строк: `/*` внутри литерала съел бы импорты до ближайшего
 * закрывающего, и гейт пропустил бы нарушение.
 *
 * Нужен собранный `dist` ядра: гейт границ и `check:vendor` поэтому идут
 * после `yarn build`; тесты скриптов берут исходник через алиас в
 * `vitest.config.mjs`.
 */
export { collectImportSpecifiers } from '@feugene/granum/node'

export function isRelative(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../')
}
