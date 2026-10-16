// ТЗ-2. node resolver-subcomponents.mjs <каталог приложения монорепо granularity>,
// например apps/playground.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const app = process.argv[2]
const req = createRequire(`${app}/package.json`)
const { granumResolver } = await import(pathToFileURL(req.resolve('@feugene/granum/vite')).href)
const resolver = granumResolver({ providers: ['@feugene/granularity'] }, { root: app })
for (const name of ['GrList', 'GrListItem', 'GrTabPanel', 'GrDropdownMenuItem'])
  console.log(name.padEnd(20), JSON.stringify(resolver.resolve(name)))
