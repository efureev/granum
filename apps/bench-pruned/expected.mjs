/**
 * Что bench-pruned обязан эмитить. Проверяется `node scripts/verify-app.mjs`.
 *
 * Стенд отличается от `bench-one` ровно одной строкой конфига
 * (`pruneTokens.mode: 'on'`), поэтому его ожидания — это список того, что
 * обрезка обязана СОХРАНИТЬ и что обязана УБРАТЬ. Каждая строка в `present`
 * закрывает случай, в котором обрезка ломается молча: сборка зелёная, а
 * переменная разрешается в пустоту.
 */
export default {
  purpose: 'обрезка токенов включена: что уцелело и что ушло',
  doctor: {
    // Те же две находки фикстуры, что и у `bench-one`: стенды отличаются
    // одной строкой конфига, а не набором дефектов.
    warnings: { 'safelist-dead': 1, 'safelist-redundant': 1 },
  },
  css: {
    present: [
      // Имя собирается в рантайме из общего модуля; держит только `dynamicTokens` у XhOverlay.
      { what: 'токен с динамическим именем уцелел', css: '--xh-z-dropdown' },
      // Читается из JS по имени (`getPropertyValue`), `var()` нет — литерал в чанке попал в `consumes`.
      { what: 'токен, читаемый из JS по имени, уцелел', css: '--xh-alert-duration' },
      // Объявлен ТОЛЬКО в светлой теме; ссылается на него токен, объявленный ТОЛЬКО в тёмной.
      { what: 'токен светлой темы, нужный только тёмной, уцелел', css: '--xh-fg-boost' },
      { what: 'парный ему токен тёмной темы уцелел', css: '--xh-elevated-fg' },
      { what: 'цепочка роль → роль уцелела', css: '--xh-invalid-brd' },
      { what: 'фолбэк производной роли внутри @supports уцелел', css: '@supports not' },
      { what: 'структура тем не тронута: тёмная тема на месте', css: 'data-theme=dark' },
      { what: 'base.css не обрезается — его правила на месте', css: 'box-sizing' },
    ],
    absent: [
      { what: 'сырая палитра, которую не берёт ни один выбранный компонент', css: '--xh-amber-500' },
      { what: 'токен компонента, которого нет в сборке', css: '--xh-table-head-bg' },
      { what: 'неиспользуемая ступень шкалы отступов', css: '--xh-space-0' },
      { what: 'неиспользуемые контейнеры', css: '--xh-container-lg' },
    ],
  },
  report: (report, check) => {
    check(report.prune?.mode === 'on', `prune mode: ${report.prune?.mode}`)
    check(report.prune.removable.includes('xh-amber-500') && report.prune.removable.includes('xh-table-head-bg'), `removable: ${report.prune.removable}`)
    check(!report.prune.removable.includes('xh-z-dropdown') && !report.prune.removable.includes('xh-fg-boost'), 'kept tokens are not in removable')
    check(report.prune.deadPatterns.length === 0, `dead patterns: ${report.prune.deadPatterns}`)
    check(report.classes.unmatched.map(u => u.className).join(',') === 'shadow-legacy', `unmatched: ${JSON.stringify(report.classes.unmatched)}`)
  },
}
