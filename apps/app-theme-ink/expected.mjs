/** Что app-theme-ink обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
export default {
  purpose: 'тема ink: цепочки тем и режимов для токенов компонентов, дополнительная paper — своим листом',
  doctor: {
    // Папка `themes/unknown/` спутника — тема, которой нет ни в одном каталоге.
    // `--tc-chart-label` спутник читает только через запасное значение и хуком не
    // объявил — намеренная находка: так виден переименованный или забытый токен.
    warnings: { 'component-theme-unknown': 1, 'token-fallback-only': 1 },
  },
  css: {
    present: [
      { what: 'режим по умолчанию под :where(:root) и своей парой', css: ':where(:root),[data-theme=ink-light]{' },
      { what: 'режим dim своей парой', css: '[data-theme=ink-dim]{' },
      { what: 'свой литерал root темы', css: '--th-radius:2px' },
      { what: 'токен кнопки ink-light — свой', css: '--td-button-shadow:0 0 0 1px var(--th-fg)' },
      { what: 'токены спутника для ink', css: '--tc-chart-grid:#374151' },
      { what: 'лист paper: формулы под списком её пар', css: '[data-theme=paper-light],[data-theme=paper-dark]{' },
      { what: 'лист paper: полный блок пары со своим литералом root', css: '[data-theme=paper-light]{--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light;--td-button-shadow:0 1px 2px #0000001f;--td-card-pad:12px' },
      { what: 'вариант dark: по парам dark и dim', css: '[data-theme=ink-dim] .dark\\:underline' },
      { what: 'вариант dark: и по тёмной паре дополнительной темы', css: '[data-theme=paper-dark] .dark\\:underline' },
    ],
    absent: [
      { what: 'дополнительная тема под :root', css: ':root,[data-theme=paper-' },
      { what: 'граница по префиксу значения', css: '[data-theme^=' },
      { what: 'классы активации 2.x', css: '.dark{' },
    ],
  },
  js: {
    present: [{ what: 'манифест тем с парой dim', js: 'ink-dim' }, { what: 'адрес листа paper', js: 'granum-theme-paper-' }],
  },
  report: (report, check) => {
    check(report.themes.defaultTheme === 'ink' && report.themes.themeSource === 'provider', `theme: ${report.themes.defaultTheme} (${report.themes.themeSource})`)
    check(report.themes.themes.map(theme => `${theme.id}:${theme.modes.join('+')}`).join(',') === 'ink:light+dark+dim,paper:light+dark', `themes: ${JSON.stringify(report.themes.themes)}`)
  },
}
