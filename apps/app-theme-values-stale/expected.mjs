/** Что app-theme-values-stale обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
export default {
  purpose: 'тема отстала от пакета компонентов: выход за targets, нехватка значений, хук и неизвестный компонент — находки, а не молчание',
  doctor: {
    warnings: {
      // Написана под ^0.9.0, в сборке 1.0.0.
      'theme-target-mismatch': 1,
      // Зазора группы (`--vd-group-gap`) в 0.9 не было, тема его не задаёт.
      'theme-incomplete': 1,
      // Тень кнопки — хук: тема его не задаёт.
      'theme-token-foreign': 1,
      // `VdTabs` в пакете нет.
      'theme-component-unknown': 1,
    },
    check: (report, check) => {
      const found = Object.fromEntries(report.diagnostics.map(d => [d.code, d]))
      check(found['theme-target-mismatch']?.subject === 'stale → @granum-fixtures/valued-ds', `выход за targets: ${found['theme-target-mismatch']?.subject}`)
      check(JSON.stringify(found['theme-incomplete']?.items) === '["light:vd-group-gap"]', `нехватка: ${JSON.stringify(found['theme-incomplete']?.items)}`)
      check(found['theme-token-foreign']?.subject === 'stale → @granum-fixtures/valued-ds:VdButton' && /vd-button-shadow/.test(found['theme-token-foreign'].message), `хук: ${found['theme-token-foreign']?.subject} ${found['theme-token-foreign']?.message}`)
      check(found['theme-component-unknown']?.subject === 'stale → @granum-fixtures/valued-ds:VdTabs', `неизвестный компонент: ${found['theme-component-unknown']?.subject}`)
    },
  },
  css: {
    present: [
      { what: 'лист устаревшей темы', css: '[data-theme=stale-light]{' },
      { what: 'значения применяются и при находке', css: '--vd-tabs-gap:2px' },
    ],
  },
  report: (report, check) => {
    const stale = report.themes.themes.find(theme => theme.id === 'stale')
    check(stale?.version === '0.9.2', `версия: ${stale?.version}`)
    check(stale?.targets?.[0]?.status === 'mismatch' && stale.targets[0].version === '1.0.0', `targets: ${JSON.stringify(stale?.targets)}`)
  },
}
