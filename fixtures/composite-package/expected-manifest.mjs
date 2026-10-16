import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export default function ({ manifest, distDir, check }) {
  const c = manifest.components
  check(manifest.id === '@granum-fixtures/composite', 'id')
  // Компонентов два: часть `XcListItem` — не компонент, у неё нет ни конфига, ни
  // entry, её код в чанке родителя. Манифест записывает её частью владельца: по
  // ней guard и селекция приложения судят `XcList`.
  check(Object.keys(c).sort().join(',') === 'XcButton,XcList', `components: ${Object.keys(c)}`)
  check(JSON.stringify(c.XcList.subcomponents) === '["XcListItem"]', `XcList.subcomponents: ${JSON.stringify(c.XcList.subcomponents)}`)
  check(c.XcButton.subcomponents === undefined, `XcButton.subcomponents: ${JSON.stringify(c.XcButton.subcomponents)}`)
  check(c.XcList.entry === 'components/XcList/index.js', `XcList.entry: ${c.XcList.entry}`)
  check(c.XcList.css.join(',') === 'components/XcList/styles.css', `XcList.css: ${c.XcList.css}`)
  // Классы части учтены у родителя: шаблон части — в его чанке.
  check(['divide-y', 'px-3', 'py-2'].every(name => c.XcList.classes.includes(name)), `XcList.classes: ${c.XcList.classes}`)
  // Subpath части ведёт в модуль родителя — алиас `codegen --subcomponents`.
  const pkg = JSON.parse(readFileSync(join(distDir, '..', 'package.json'), 'utf8'))
  check(pkg.exports['./components/XcListItem'] === pkg.exports['./components/XcList'], `exports XcListItem: ${pkg.exports['./components/XcListItem']}`)
  check(manifest.warnings.length === 0, `warnings: ${JSON.stringify(manifest.warnings)}`)
}
