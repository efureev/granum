/**
 * Что стенд JS-канала обязан эмитить. Проверяется `node scripts/verify-app.mjs`.
 *
 * Одно утверждение здесь главное, и ради него стенд и существует: в селекции
 * два компонента, в бандле — один. `virtual:granum/components` состоит из
 * реэкспортов и не имеет побочных эффектов, поэтому невостребованный экспорт
 * вырезается tree-shaking'ом (A-5, INV-JS-1). До этого стенда форма модуля
 * жила только в юните на программной сборке.
 *
 * Второе утверждение — контраст каналов: CSS невыбранного в бандле компонента
 * в дистрибутиве ЕСТЬ, потому что CSS идёт по селекции, а не по импортам. Это
 * не дефект: селекцию никто не сужал, и `granum audit` на стенде чист.
 */
export default {
  purpose: 'JS-канал на настоящей сборке: импорт одного компонента из virtual:granum/components вырезает второй',
  css: {
    present: [
      { what: 'собственный CSS выбранного и импортированного XxCard', css: '.xxx-card{' },
      { what: 'его утилита с произвольным значением', css: '.p-\\[var\\(--xxx-space-2\\)\\]' },
      // Компонент в селекции, но не в бандле: CSS о его судьбе в JS не знает.
      { what: 'утилита XxBadge, которого нет в JS', css: '.inline-block{' },
      { what: 'его акцентная утилита', css: '.bg-\\[var\\(--xxx-accent\\)\\]' },
      { what: 'акцентный токен, который берёт только XxBadge', css: '--xxx-accent:' },
      { what: 'утилита разметки приложения', css: '.max-w-md{' },
    ],
    absent: [
      // Тема одна: второй блок не эмитится целиком.
      { what: 'селектор тёмной темы', css: '[data-theme=dark]' },
    ],
  },
  js: {
    present: [{ what: 'код XxCard: его имя импортировано из виртуального модуля', js: 'xxx-card' }],
    absent: [
      { what: 'имя невыбранного в разметке компонента', js: 'XxBadge' },
      { what: 'его класс: реэкспорт вырезан целиком, а не оставлен пустым', js: 'inline-block' },
      { what: 'его акцентная утилита', js: 'bg-[var(--xxx-accent)]' },
    ],
  },
  report: (report, check) => {
    const selection = report.selection.map(s => s.key).join(',')
    check(
      selection === '@granum-fixtures/mini-ds:XxBadge,@granum-fixtures/mini-ds:XxCard',
      `selection: ${selection} — в селекции обязаны быть оба компонента, иначе утверждение стенда пустое`,
    )
    check(report.classes.unmatched.length === 0, `unmatched: ${JSON.stringify(report.classes.unmatched)}`)
    check(report.tokens.undefined.length === 0, `undefined tokens: ${report.tokens.undefined}`)
    /*
     * `classes.app` — классы разметки приложения, которые есть и у компонентов
     * пакетов. Ровно они и нужны аудиту: без них класс из `App.vue`, совпавший
     * с классом невыбранного компонента, выглядел бы утечкой. Всё остальное в
     * отчёте не лежит — на витрине это было бы 33 тысячи имён.
     */
    check(report.classes.app.includes('p-[var(--xxx-space-2)]'), `classes.app: ${report.classes.app}`)
    check(!report.classes.app.includes('max-w-md'), `classes.app содержит класс, которого нет ни у одного компонента: ${report.classes.app}`)
    check(report.prune === null, `prune: ${JSON.stringify(report.prune)}`)
  },
}
