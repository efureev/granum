/**
 * Что стенд аудита обязан эмитить. Проверяется `node scripts/verify-app.mjs`.
 *
 * Приложение — один div и один компонент из двух, поэтому каждая строка ниже
 * отвечает на вопрос «что осталось от пакета в дистрибутиве»: выбранное
 * обязано быть, невыбранное — исчезнуть целиком.
 */
export default {
  purpose: 'аудит дистрибутива: выбранный компонент на месте, невыбранный вырезан вместе с классами и токенами',
  css: {
    present: [
      { what: 'тема-независимый токен, который берёт XxCard', css: '--xxx-space-2:12px' },
      { what: 'второй его токен', css: '--xxx-radius:6px' },
      { what: 'собственный CSS XxCard из манифеста', css: '.xxx-card{' },
      { what: 'светлая тема: поверхность и текст', css: '--xxx-bg:#fff' },
      { what: 'утилита из класса XxCard', css: '.p-\\[var\\(--xxx-space-2\\)\\]' },
      { what: 'утилита разметки приложения из appSources', css: '.max-w-md{' },
    ],
    absent: [
      // Токены, которые берёт только XxBadge: компонент не выбран, и обрезка
      // обязана снять их из активной темы.
      { what: 'акцентный токен бейджа', css: '--xxx-accent' },
      { what: 'парный ему токен текста', css: '--xxx-accent-fg' },
      { what: 'шаг шкалы, который берёт только бейдж', css: '--xxx-space-1' },
      // Тема одна: блок тёмной темы не попадает в дистрибутив целиком, а не
      // приезжает обрезанным до пустоты.
      { what: 'селектор тёмной темы', css: '[data-theme=dark]' },
      { what: 'значение тёмной поверхности', css: '#0b1120' },
      // Мёртвый груз дизайн-системы: не берёт ни один компонент.
      { what: 'типографический токен, который не берёт никто', css: '--xxx-font-sm' },
      { what: 'приглушённый цвет, который не берёт никто', css: '--xxx-muted' },
      { what: 'класс невыбранного бейджа', css: 'inline-block' },
    ],
  },
  js: {
    present: [{ what: 'код XxCard в чанке пакета', js: 'xxx-card' }],
    absent: [
      { what: 'код невыбранного XxBadge — его выбросил tree-shaking, хотя барель экспортирует оба', js: 'inline-block' },
      { what: 'его акцентный класс', js: 'bg-[var(--xxx-accent)]' },
    ],
  },
  report: (report, check) => {
    check(report.selection.map(s => s.key).join(',') === '@granum-fixtures/mini-ds:XxCard', `selection: ${report.selection.map(s => s.key)}`)
    check(report.classes.unmatched.length === 0, `unmatched: ${JSON.stringify(report.classes.unmatched)}`)
    check(report.tokens.undefined.length === 0, `undefined tokens: ${report.tokens.undefined}`)
    check(report.themes.names.join(',') === 'light', `themes: ${report.themes.names}`)
    check(report.prune?.mode === 'on', `prune mode: ${report.prune?.mode}`)
    // Ровно половина объявленного пакетом: пять токенов из десяти.
    check(report.prune.removable.join(' ') === 'xxx-accent xxx-accent-fg xxx-font-sm xxx-muted xxx-space-1', `removable: ${report.prune.removable}`)
    check(report.prune.deadPatterns.length === 0, `dead patterns: ${report.prune.deadPatterns}`)
    check(report.sizesSource === 'bundle', `sizesSource: ${report.sizesSource}`)
  },
}
