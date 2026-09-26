import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { atomsEngine, ATOMS_DIALECT } from '@granum-engines/atoms'
import { atomsRules } from './dist/granum-provider/engine.js'

/**
 * Round-trip идёт движком этого словаря и с правилами самого пакета: чужой
 * движок не знает ни одного имени `atom-*`, и сверка была бы бессмысленной.
 */
export function engine() {
  return atomsEngine({ rules: atomsRules })
}

export default function ({ manifest, distDir, check }) {
  const c = manifest.components
  check(manifest.id === '@granum-fixtures/atoms', 'id')
  check(Object.keys(c).join(',') === 'AtBox,AtChip', `состав: ${Object.keys(c)}`)

  // Блок движка — факт о происхождении списка классов (M-E2, M-E5, INV-ENG-10).
  check(manifest.engine.dialect === ATOMS_DIALECT, `dialect: ${manifest.engine.dialect}`)
  check(manifest.engine.name === 'granum-fixtures-atoms-engine', `engine.name: ${manifest.engine.name}`)
  check(/^fnv64-[0-9a-f]{16}$/.test(manifest.engine.vocabulary), `vocabulary: ${manifest.engine.vocabulary}`)

  // Правила пакета едут модулем, а не в JSON (M-E4), и файл существует.
  check(manifest.engine.module === 'granum-provider/engine.js', `engine.module: ${manifest.engine.module}`)
  check(existsSync(join(distDir, 'granum-provider/engine.js')), 'модуль правил собран')

  // `atom-frame` есть только в правилах пакета: без них класс не сгенерировать.
  check(c.AtBox.classes.join(' ') === 'atom-bg-[var(--at-bg)] atom-frame atom-gap-2 atom-stack', `AtBox.classes: ${c.AtBox.classes}`)
  check(c.AtChip.classes.join(' ') === 'atom-inline atom-pad-1 atom-round', `AtChip.classes: ${c.AtChip.classes}`)
  check(manifest.theme.declares.join(' ') === '--at-bg --at-fg --at-line --at-radius', `declares: ${manifest.theme.declares}`)
  check(manifest.warnings.length === 0, `warnings: ${JSON.stringify(manifest.warnings)}`)
}
