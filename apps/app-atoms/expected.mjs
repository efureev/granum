/**
 * Стенд «свой движок» (AC-E2, AC-E4): приложение работает на движке, которого в
 * granum нет вовсе, и держит в одной сборке два пакета разной природы — один на
 * том же словаре с собственными правилами, второй без словаря совсем.
 *
 * Чисто по докторy: ни одного предупреждения. Ветка «диалект и отпечаток
 * расходятся» здесь тоже присутствует (приложение добавило правило фабрике), но
 * пересчёт даёт тот же набор — совместимость измерена, а не обещана.
 */
export default {
  purpose: 'свой движок: пакет того же словаря с правилами из модуля плюс пакет без словаря',
  doctor: { warnings: {} },
  css: {
    present: [
      { what: 'словарь движка: встроенное правило atom-stack', css: 'flex-direction:column' },
      { what: 'правило ПАКЕТА из его модуля: диалекты совпали, правила загружены', css: 'atom-frame' },
      { what: 'правило ПРИЛОЖЕНИЯ из фабрики движка', css: 'atom-hairline' },
      { what: 'числовая шкала словаря: atom-pad-4 из App.vue', css: 'padding:16px' },
      { what: 'CSS компонента пакета без словаря', css: '.pl-card' },
      { what: 'токены обоих пакетов в слое tokens', css: '--at-radius' },
      { what: 'токены пакета без словаря', css: '--pl-radius' },
    ],
    absent: [
      { what: 'ни одного имени preset-mini: словарь другой', css: '--un-' },
      { what: 'классов невыбранного AtChip', css: 'atom-round' },
      { what: 'CSS невыбранного PlNote', css: '.pl-note' },
    ],
  },
  report: (report, check) => {
    check(report.engine.name === 'granum-fixtures-atoms-engine', `движок: ${report.engine.name}`)
    check(report.engine.dialect === 'granum-fixtures/atoms@1', `диалект приложения: ${report.engine.dialect}`)

    // Пакет своего словаря: правила загружены, пересчёт совпал с манифестом.
    const atoms = report.providers.find(p => p.id === '@granum-fixtures/atoms')
    check(atoms?.dialect === 'granum-fixtures/atoms@1', `диалект пакета: ${atoms?.dialect}`)
    check(atoms?.rulesLoaded === true, `правила пакета загружены: ${atoms?.rulesLoaded}`)
    check(atoms?.lost.length === 0 && atoms?.gained.length === 0, `наборы совпали: lost=${atoms?.lost} gained=${atoms?.gained}`)

    // Пакет без словаря: быстрый путь при любом движке, пересчёта нет.
    const plain = report.providers.find(p => p.id === '@granum-fixtures/plain')
    check(plain?.dialect === null && plain?.vocabulary === null, `пакет без словаря: ${JSON.stringify(plain)}`)
    check(plain?.classes === 'manifest' && plain?.reason === 'none', `быстрый путь: ${plain?.classes}/${plain?.reason}`)

    check(report.classes.unmatched.length === 0, `unmatched: ${JSON.stringify(report.classes.unmatched)}`)
  },
}
