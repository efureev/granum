/** Что app-4 обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
export default {
  purpose: 'классы вложенных SFC из манифеста + доп-правила движка под variablePrefix',
  css: {
    present: [
      { what: 'класс из вложенного XNestedHeader (лежит в чанке XNestedReverse)', css: '.text-7xl' },
      { what: 'класс из вложенного XNestedFooter', css: '.tracking-widest' },
      { what: 'класс собственного шаблона XNestedReverse', css: '.rounded-3xl' },
      { what: 'animationRules', css: 'animate-spin{animation:1s linear infinite granularity-spin}' },
      { what: 'animationPreflights (keyframes отдельно от правила)', css: '@keyframes granularity-spin' },
      { what: 'colorOpacityRules: bracket-цвет с /NN', css: 'background-color:#0ea5e94d' },
      { what: 'filterRules: несколько фильтров через кастомные свойства', css: '--ds-blur' },
      { what: 'filterRules: @property регистрирует то же имя, на которое ссылается утилита', css: '@property --ds-blur' },
      { what: 'numericRules: tabular-nums пишет свою переменную, а не свойство', css: '--ds-numeric-spacing:tabular-nums' },
      { what: 'numericPreflights под variablePrefix: объявления переменных под тем же префиксом', css: '--ds-numeric-spacing: ' },
      { what: 'numericRules: normal-nums сбрасывает свойство целиком', css: 'font-variant-numeric:normal' },
      { what: 'objectRules: object-fit', css: 'object-fit:cover' },
      { what: 'objectRules: object-position из bracket-значения', css: 'object-position:50% 20%' },
      { what: 'spacingRules + spacingVariants', css: 'space-x-4' },
      { what: 'accessibilityRules: sr-only', css: 'clip:rect(0,0,0,0)' },
      { what: 'accessibilityRules: not-sr-only под вариантом focus', css: 'not-sr-only:focus' },
    ],
    absent: [
      { what: 'CSS невыбранного XTest1', css: '.x-sp-test' },
      { what: 'ни одного `@property --un-*`: имя в селекторе едет через postprocess вместе с entries', css: '@property --un-' },
      { what: 'переменные фильтров под чужим префиксом', css: '--un-blur' },
      { what: 'переменные font-variant-numeric под чужим префиксом', css: '--un-numeric-' },
      { what: 'preflight пресета под чужим префиксом', css: '--un-rotate' },
    ],
  },
  report: (report, check) => {
    check(report.selection.map(s => s.key).join(',') === '@granum-fixtures/simple:XNestedReverse', `selection: ${report.selection.map(s => s.key)}`)
    check(report.classes.unmatched.length === 0, `unmatched: ${JSON.stringify(report.classes.unmatched)}`)
  },
}
