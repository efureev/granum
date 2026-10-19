/**
 * Что bench-one обязан эмитить. Проверяется `node scripts/verify-app.mjs`.
 *
 * Стенд меряет вес, но подстрочные проверки здесь не про байты, а про два
 * инварианта, без которых замер бессмыслен: фундамент приезжает целиком, а
 * невыбранные компоненты не приезжают вовсе.
 */
export default {
  purpose: 'подопытный стенд замера: один компонент поверх полного фундамента',
  doctor: {
    // Намеренные дефекты фикстуры heavy: `shadow-legacy` без правила движка и
    // строки тонов `XhButton`, видимые и статически.
    warnings: { 'safelist-dead': 1 },
  },
  css: {
    present: [
      { what: 'токен фундамента из tokensCss — приезжает независимо от селекции', css: '--xh-space-4' },
      { what: 'режим light темы heavy', css: '--xh-accent' },
      { what: 'тёмный режим отдельным блоком под своей парой', css: '[data-theme=heavy-dark]{' },
      { what: '@supports-фолбэк производных color-mix — блок внутри at-rule доехал', css: '@supports not' },
      { what: 'SFC-стиль транзитивной зависимости XhCard', css: '.xh-card' },
      { what: 'объявленный cssFiles компонента XhPanel', css: '.xh-panel' },
      { what: 'утилита из safelist XhButton (класс собирается в рантайме)', css: 'var(--xh-btn-bg)' },
      // Ключевая улика замера: токен компонента, которого в сборке НЕТ, всё
      // равно объявлен — потому что данные темы без обрезки уезжают целиком.
      { what: 'токен невыбранного XhTable — объявлен фундаментом, хотя компонента в сборке нет', css: '--xh-table-head-bg' },
      // Все пять слоёв непусты, поэтому минификатор убирает вводное объявление порядка: блоки идут в порядке слоёв.
      { what: 'первый слой — tokens', css: '@layer granum.tokens{' },
      { what: 'последний слой — utilities', css: '@layer granum.utilities{' },
    ],
    absent: [
      { what: 'разметка невыбранного XhTable', css: '.xh-table' },
      { what: 'разметка невыбранного XhList', css: '.xh-list' },
      { what: 'общий SFC группы data — её членов никто не выбирал', css: '.xh-data-header' },
    ],
  },
  js: {
    present: [{ what: 'код XhPanel в чанке провайдера', js: 'xh-panel' }],
    absent: [{ what: 'код невыбранного XhTable', js: 'xh-table' }],
  },
  report: (report, check) => {
    check(report.selection.map(s => s.key).join(',') === ['XhAlert', 'XhButton', 'XhCard', 'XhOverlay', 'XhPanel'].map(n => `@granum-fixtures/heavy:${n}`).join(','), `selection: ${report.selection.map(s => s.key)}`)
    // Намеренная фикстура: `shadow-legacy` из safelist XhButton правила не имеет.
    check(report.classes.unmatched.map(u => u.className).join(',') === 'shadow-legacy', `unmatched: ${JSON.stringify(report.classes.unmatched)}`)
    check(report.tokens.undefined.length === 0, `undefined tokens: ${report.tokens.undefined}`)
    check(report.prune === null, 'prune off → no plan in the report')
  },
}
