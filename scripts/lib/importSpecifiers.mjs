/**
 * Извлекает спецификаторы импортов из собранного ES-модуля.
 *
 * Регэкспы, а не парсер: `dist` не минифицирован, а ложное срабатывание лишь
 * делает проверку строже. Комментарии срезаются заранее — иначе JSDoc вида
 * «импорт из `@unocss/core`» даёт ложное нарушение границы.
 */
export function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
}

const STATIC_FROM = /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g
const STATIC_BARE = /\bimport\s*['"]([^'"]+)['"]/g
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g

export function collectImportSpecifiers(code) {
  const source = stripComments(code)
  const out = new Set()
  for (const re of [STATIC_FROM, STATIC_BARE, DYNAMIC, REQUIRE]) {
    for (const m of source.matchAll(re))
      out.add(m[1])
  }
  return [...out].sort()
}

export function isRelative(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../')
}
