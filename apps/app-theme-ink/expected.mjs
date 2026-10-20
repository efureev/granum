/** Что app-theme-ink обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
export default {
  purpose: 'тема ink: цепочки тем и режимов для токенов компонентов, превью paper полными блоками',
  doctor: {
    // Папка `themes/unknown/` спутника — тема, которой нет ни в одном каталоге (C-36).
    warnings: { 'component-theme-unknown': 1 },
  },
  css: {
    present: [
      { what: 'режим по умолчанию под :root и своей парой', css: ':root,[data-theme=ink-light]{' },
      { what: 'режим dim своей парой', css: '[data-theme=ink-dim]{' },
      { what: 'свой литерал root темы', css: '--th-radius:2px' },
      { what: 'токен кнопки ink-light — свой', css: '--td-button-shadow:0 0 0 1px var(--th-fg)' },
      { what: 'токены спутника для ink', css: '--tc-chart-grid:#374151' },
      { what: 'превью paper: формулы под списком её пар', css: '[data-theme=paper-light],[data-theme=paper-dark]{' },
      { what: 'превью paper: полный блок пары со своим литералом root', css: '[data-theme=paper-light]{--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light;--td-button-shadow:0 1px 2px #0000001f;--td-card-pad:12px' },
      { what: 'вариант dark: по парам dark и dim', css: '[data-theme=ink-dim] .dark\\:underline' },
    ],
    absent: [
      { what: 'превью под :root', css: ':root,[data-theme=paper-' },
      { what: 'превью под префиксом значения', css: '[data-theme^=' },
      { what: 'классы активации 2.x', css: '.dark{' },
    ],
  },
  js: {
    present: [{ what: 'манифест тем с парой dim', js: 'ink-dim' }],
  },
  report: (report, check) => {
    check(report.themes.theme === 'ink' && report.themes.themeSource === 'provider', `theme: ${report.themes.theme} (${report.themes.themeSource})`)
    check(report.themes.modes.join(',') === 'light,dark,dim', `modes: ${report.themes.modes}`)
    check(report.themes.previews.join(',') === 'paper', `previews: ${report.themes.previews}`)
  },
}
