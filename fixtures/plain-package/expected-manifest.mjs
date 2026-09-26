export default function ({ manifest, check }) {
  const c = manifest.components
  check(manifest.id === '@granum-fixtures/plain', 'id')
  check(Object.keys(c).join(',') === 'PlCard,PlNote', `состав: ${Object.keys(c)}`)

  // Ни одного класса и ни одной записи safelist — значит артефакт ни от какого
  // словаря не зависит, и диалект с отпечатком равны `null` (E-3, M-E5).
  check(manifest.engine.dialect === null, `dialect: ${manifest.engine.dialect}`)
  check(manifest.engine.vocabulary === null, `vocabulary: ${manifest.engine.vocabulary}`)
  check(manifest.engine.module === null, `engine.module: ${manifest.engine.module}`)
  // Имя реализации всё равно записано: это диагностика, а не основание решений.
  check(manifest.engine.name.length > 0, 'engine.name')

  for (const [name, component] of Object.entries(c)) {
    check(component.classes.length === 0, `${name}.classes непуст: ${component.classes}`)
    check(component.safelist.length === 0, `${name}.safelist непуст: ${component.safelist}`)
    check(component.css.length === 1, `${name}.css: ${component.css}`)
  }

  // Вся отделка — через токены: их пакет объявляет и потребляет сам.
  check(manifest.theme.declares.join(' ') === '--pl-gap --pl-ink --pl-radius --pl-surface', `declares: ${manifest.theme.declares}`)
  check(c.PlCard.tokens.consumes.join(' ') === '--pl-gap --pl-ink --pl-radius --pl-surface', `PlCard.consumes: ${c.PlCard.tokens.consumes}`)
  check(manifest.warnings.length === 0, `warnings: ${JSON.stringify(manifest.warnings)}`)
}
