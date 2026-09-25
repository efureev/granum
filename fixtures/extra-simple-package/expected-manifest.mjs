import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export default function ({ manifest, distDir, check }) {
  const c = manifest.components
  check(manifest.id === '@granum-fixtures/extra-simple', 'id')
  check(manifest.dependencies.join(',') === '@granum-fixtures/simple', `dependencies: ${manifest.dependencies}`)
  // Кросс-провайдерные зависимости объявлены и совпадают с фактическими импортами (INV-CON-5).
  check(c.XgQuick.dependencies.join(',') === '@granum-fixtures/simple:XTest1', `XgQuick.deps: ${c.XgQuick.dependencies}`)
  check(c.XTokenizedLevel2.dependencies.join(',') === '@granum-fixtures/simple:XTokenized', `L2.deps: ${c.XTokenizedLevel2.dependencies}`)
  // Объявленный CSS скопирован по контрактному пути и стоит в манифесте (B-3).
  check(c.XgQuick.css.join(',') === 'components/XgQuick/styles.css', `XgQuick.css: ${c.XgQuick.css}`)
  check(readFileSync(join(distDir, 'components/XgQuick/styles.css'), 'utf8').includes('.xg-quick'), 'styles.css copied')
  // Класс из HTML-комментария не извлечён (INV-ENG-5).
  check(!c.XgQuick.classes.includes('p-5'), `XgQuick.classes: ${c.XgQuick.classes}`)
  check(c.XTokenizedLevel2.classes.join(' ') === 'font-bold p-4', `L2.classes: ${c.XTokenizedLevel2.classes}`)
  check(manifest.warnings.length === 0, `warnings: ${JSON.stringify(manifest.warnings)}`)
}
