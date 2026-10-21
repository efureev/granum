#!/usr/bin/env node
/**
 * Сборка пакета темы: исходник (C-42) → тема-объект в `dist`. Наследование
 * `extends: 'stone'` не раскрывается: его раскроет приложение от установленной
 * темы каталога (A-22) — так правки «Камня» приходят в «Прилив».
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadThemeSource } from '@feugene/granum/node'

// `sources` — пути этой машины для перезагрузки в dev; в пакет они не едут.
const { sources: _sources, ...theme } = loadThemeSource(new URL('./src/tide/', import.meta.url))
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true })
writeFileSync(new URL('./dist/index.js', import.meta.url), `export default ${JSON.stringify(theme, null, 2)}\n`)
writeFileSync(new URL('./dist/index.d.ts', import.meta.url), `import type { GranumAppTheme } from '@feugene/granum'\n\ndeclare const theme: GranumAppTheme\nexport default theme\n`)
console.log(`theme-tide: ${theme.id} ${theme.version} → dist/index.js`)
