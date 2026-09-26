export default {
  purpose: 'донор по имени пакета и кросс-пакетная зависимость компонента',
  doctor: {
    // Тот же `--brd` из `XTest1`, что и в app-1: цвет границы даёт приложение.
    warnings: { 'token-undefined': 1 },
  },
  css: {
    present: [
      { what: 'объявленный cssFiles компонента XgQuick', css: '.xg-quick' },
      { what: 'CSS транзитивного XTest1 из пакета-донора', css: '.x-sp-test' },
      { what: 'арбитражное значение из шаблона донорского XTest1 — классы пришли из ОБОИХ манифестов', css: 'var(--brd)' },
    ],
    absent: [
      { what: 'safelist XTestStyled — компонент донора, который никто не выбирал', css: '--card-fg' },
      { what: 'класс из HTML-комментария XgQuick (INV-ENG-5)', css: 'padding:1.25rem' },
    ],
  },
  report: (report, check) => {
    check(report.selection.map(s => s.key).join(',') === '@granum-fixtures/simple:XTest1,@granum-fixtures/extra-simple:XgQuick', `selection: ${report.selection.map(s => s.key)}`)
  },
}
