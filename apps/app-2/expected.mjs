/** Что app-2 обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
export default {
  purpose: 'safelist для классов, собираемых в JS, и токены приложения через tokenOverrides',
  css: {
    present: [
      { what: 'блок токенов темы, созданный приложением через themes.tokenOverrides — слой themes', css: '--brd:#02f8fa' },
      { what: 'второй токен того же блока', css: '--card-fg:#af172a' },
      { what: 'класс из safelist XTestStyled (собирается в JS, статически не извлекается)', css: 'var(--card)' },
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
    // Классы XTestStyled лежат и в classes, и в safelist манифеста: строка `base` видна статически.
    check(report.classes.safelistRedundant.includes('bg-[var(--card)]'), `safelistRedundant: ${report.classes.safelistRedundant}`)
  },
}
