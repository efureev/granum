/** Спецификаторы импортов собранного модуля — для проверок границы на `dist` (INV-BND-1). */
import { builtinModules } from 'node:module'

const NODE_BUILTINS = new Set(builtinModules)
const GRANUM_NODE_ENTRY_RE = /^@feugene\/granum\/(?:build|vite|node|codegen)(?:\/|$)/

export function collectImportSpecifiers(code: string): string[] {
  const source = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
  const out = new Set<string>()
  for (const re of [
    /\b(?:import|export)\b[^'";]+?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
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
