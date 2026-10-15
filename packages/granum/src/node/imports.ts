/** Спецификаторы импортов собранного модуля — для проверок границы на `dist` (INV-BND-1). */
import { builtinModules } from 'node:module'
import { stripCommentsWith } from '../engine/extract'

const NODE_BUILTINS = new Set(builtinModules)
const GRANUM_NODE_ENTRY_RE = /^@feugene\/granum\/(?:build|vite|node|codegen)(?:\/|$)/

export function collectImportSpecifiers(code: string): string[] {
  // Срез с учётом строк: `/*` внутри `'./icons/*.svg'` не съедает импорты дальше по файлу.
  const source = stripCommentsWith(code, 'module.js', 'all')
  const out = new Set<string>()
  // Спецификатор не содержит пробелов: иначе закрывающая кавычка строки
  // `"import"` в коде давала «голый импорт» длиной до следующей кавычки.
  for (const re of [
    /\b(?:import|export)\b[^'";]+?\bfrom\s*['"]([^'"\s]+)['"]/g,
    /\bimport\s*['"]([^'"\s]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"\s]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"\s]+)['"]\s*\)/g,
  ]) {
    for (const m of source.matchAll(re))
      out.add(m[1]!)
  }
  return [...out].sort()
}

export function boundaryKindOf(specifier: string): 'node-import' | 'granum-node-entry' | undefined {
  if (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier))
    return 'node-import'
  if (GRANUM_NODE_ENTRY_RE.test(specifier))
    return 'granum-node-entry'
  return undefined
}
