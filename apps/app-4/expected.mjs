/** Что app-4 обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
export default {
  purpose: 'классы вложенных SFC из манифеста + словарь движка под variablePrefix',
  css: {
    present: [
      { what: 'класс из вложенного XNestedHeader (лежит в чанке XNestedReverse)', css: '.text-7xl' },
      { what: 'класс из вложенного XNestedFooter', css: '.tracking-widest' },
      { what: 'класс собственного шаблона XNestedReverse', css: '.rounded-3xl' },
      // Слой `base` здесь состоит только из preflight движка: ни `tokens.css`, ни
      // `base.css` у провайдера фикстуры нет. Проверяется и место, и префикс —
      // переменные, на которые ссылаются утилиты, обязаны быть объявлены под тем
      // же именем, иначе значение `filter` невалидно и фильтра просто нет.
      { what: 'preflight движка — в слое base, под нужным префиксом (E-15, INV-CSS-8)', css: '@layer granum.base{*,:before,:after,::backdrop{--ds-rotate:0' },
      { what: 'переменные фильтров объявлены в preflight', css: '--ds-blur: ' },
      { what: 'переменные font-variant-numeric объявлены в preflight', css: '--ds-numeric-spacing: ' },
      { what: 'keyframes анимации рождает правило, а не preflight', css: '@keyframes spin' },
      { what: 'утилита анимации ссылается на те же keyframes', css: 'animate-spin{animation:1s linear infinite spin}' },
      { what: 'альфа на литеральном цвете в скобках', css: 'background-color:#0ea5e94d' },
      { what: 'фильтры собираются через кастомные свойства под префиксом', css: '--ds-blur:blur(8px)' },
      { what: 'tabular-nums пишет свою переменную, а не свойство', css: '--ds-numeric-spacing:tabular-nums' },
      { what: 'normal-nums сбрасывает свойство целиком', css: 'font-variant-numeric:normal' },
      { what: 'object-fit', css: 'object-fit:cover' },
      { what: 'object-position из bracket-значения', css: 'object-position:50% 20%' },
      { what: 'space-x-4 с вариантом-разделителем', css: 'space-x-4' },
      { what: 'sr-only', css: 'clip:rect(0,0,0,0)' },
      { what: 'not-sr-only под вариантом focus', css: 'not-sr-only:focus' },
    ],
    absent: [
      { what: 'CSS невыбранного XTest1', css: '.x-sp-test' },
      // Имя переменной едет в селектор постпроцессором вместе с декларациями,
      // поэтому регистраций `@property` в выводе нет вовсе — ни под каким префиксом.
      { what: 'регистраций @property в выводе нет', css: '@property' },
      { what: 'переменные фильтров под чужим префиксом', css: '--un-blur' },
      { what: 'переменные font-variant-numeric под чужим префиксом', css: '--un-numeric-' },
      { what: 'preflight движка под чужим префиксом', css: '--un-rotate' },
      // Preflight обязан предшествовать стилям компонентов, а не перебивать их:
      // в слое утилит его быть не может (INV-CSS-8).
      { what: 'preflight движка в слое утилит', css: 'granum.utilities{*,:before' },
    ],
  },
  report: (report, check) => {
    check(report.selection.map(s => s.key).join(',') === '@granum-fixtures/simple:XNestedReverse', `selection: ${report.selection.map(s => s.key)}`)
    check(report.classes.unmatched.length === 0, `unmatched: ${JSON.stringify(report.classes.unmatched)}`)
  },
}
