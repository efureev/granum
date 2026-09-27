/** Что app-2 обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
export default {
  purpose: 'safelist для классов, собираемых в JS, и токены приложения через tokenOverrides',
  doctor: {
    // `--card` и `--ds-radius-lg` приложение не переопределило — их и называет
    // доктор. Предупреждения `safelist-redundant` больше нет: сборка пакета
    // вычищает такие записи из манифеста сама (C-8).
    warnings: { 'token-undefined': 2 },
  },
  css: {
    present: [
      { what: 'блок токенов темы, созданный приложением через themes.tokenOverrides — слой themes', css: '--brd:#02f8fa' },
      { what: 'второй токен того же блока', css: '--card-fg:#af172a' },
      { what: 'класс XTestStyled: строка `base` уезжает в чанк литералом, извлечение её видит', css: 'var(--card)' },
      { what: 'утилита приложения поверх компонента', css: 'padding:1.5rem' },
    ],
    absent: [
      { what: 'CSS компонента XTest1 — он не выбран', css: '.x-sp-test' },
    ],
  },
  report: (report, check) => {
    check(report.selection.map(s => s.key).join(',') === '@granum-fixtures/simple:XTestStyled', `selection: ${report.selection.map(s => s.key)}`)
    check(report.classes.unmatched.length === 0, `unmatched: ${JSON.stringify(report.classes.unmatched)}`)
    // `--card` и `--ds-radius-lg` компонент потребляет, а не объявляет никто — отчёт обязан это назвать (INV-TOK-4).
    check(report.tokens.undefined.join(',') === '--card,--ds-radius-lg', `undefined tokens: ${report.tokens.undefined}`)
    // Safelist компонента вычищен на сборке пакета, поэтому пересечения у
    // приложения нет вовсе — а CSS от этого не изменился: класс в `classes`.
    check(report.classes.safelistRedundant.length === 0, `safelistRedundant: ${report.classes.safelistRedundant}`)
  },
}
