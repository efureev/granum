// ТЗ-3. Каталог приложения: package.json {"type":"module"}, index.html со скриптом
// /src/main.ts (`import 'virtual:granum.css'`), src/markup-check.ts из этой папки,
// `node_modules` — ссылка на node_modules монорепо granularity.
// Запуск из этого каталога: node regex-class-attribute.mjs
import { build } from 'vite'
import { granum } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'
await build({ root: process.cwd(), logLevel: 'warn', plugins: [granum({ engine: windEngine(), providers: ['@feugene/granularity'], components: [], appSources: { dirs: ['src'] } })] })
const { readFileSync } = await import('node:fs')
console.log(JSON.stringify(JSON.parse(readFileSync('dist/granum-report.json', 'utf8')).classes.unmatched, null, 1))
