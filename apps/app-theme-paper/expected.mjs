/** Что app-theme-paper обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
export default {
  purpose: 'тема paper: владелец по зависимости, только данные выбранной темы, токены компонентов paper',
  doctor: {
    // Папка `themes/unknown/` спутника — тема, которой нет ни в одном каталоге.
    // `--tc-chart-label` спутник читает только через запасное значение и хуком не
    // объявил — намеренная находка: так виден переименованный или забытый токен.
    warnings: { 'component-theme-unknown': 1, 'token-fallback-only': 1 },
  },
  css: {
    present: [
      { what: 'режим по умолчанию под :where(:root) и своей парой', css: ':where(:root),[data-theme=paper-light]{' },
      { what: 'тёмный режим своей парой', css: '[data-theme=paper-dark]{' },
      { what: 'формула root под общей границей — списком пар темы', css: ':where(:root),[data-theme=paper-light],[data-theme=paper-dark]{--td-button-bg:var(--th-accent)' },
      { what: 'литерал root темы в слое tokens', css: '--th-radius:6px' },
      { what: 'токен кнопки для paper-dark', css: '--td-button-shadow:none' },
      { what: 'вариант dark: по паре тёмного режима', css: '[data-theme=paper-dark] .dark\\:underline' },
    ],
    absent: [
      { what: 'данные другой темы каталога', css: 'Georgia' },
      { what: 'пары другой темы', css: 'ink-' },
      { what: 'токены спутника для ink', css: '--tc-chart-grid:' },
      { what: 'классы активации 2.x', css: '.dark{' },
    ],
  },
  js: {
    present: [{ what: 'манифест тем с парой тёмного режима', js: 'paper-dark' }],
  },
  report: (report, check) => {
    check(report.themes.defaultTheme === 'paper' && report.themes.themeSource === 'provider', `theme: ${report.themes.defaultTheme} (${report.themes.themeSource})`)
    check(report.themes.themes.map(theme => `${theme.id}:${theme.modes.join('+')}`).join(',') === 'paper:light+dark', `themes: ${JSON.stringify(report.themes.themes)}`)
  },
}
