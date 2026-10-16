// ТЗ-1. Каталог приложения: package.json {"type":"module"}, index.html со скриптом
// /src/main.ts, `node_modules` — ссылка на node_modules монорепо granularity.
// Запуск из этого каталога: node guard-subcomponent.mjs — скрипт сам пишет src/main.ts.
import { writeFileSync } from 'node:fs'
import { build } from 'vite'
import { granum } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'
for (const subpath of ['GrListItem', 'GrList']) {
  const name = subpath === 'GrList' ? 'GrList' : 'GrListItem'
  writeFileSync('src/main.ts', `import 'virtual:granum.css'\nimport { ${name} } from '@feugene/granularity/components/${subpath}'\nconsole.log(${name})\n`)
  try {
    await build({ root: process.cwd(), logLevel: 'silent', plugins: [granum({ engine: windEngine(), providers: ['@feugene/granularity'], components: [{ provider: '@feugene/granularity', names: ['GrButton'] }], appSources: { dirs: ['src'] } })] })
    console.log(`components/${subpath}: сборка прошла`)
  }
  catch (error) {
    console.log(`components/${subpath}: ${error.message.split('\n').find(line => /Error/.test(line)) ?? error.message.slice(0, 200)}`)
  }
}
