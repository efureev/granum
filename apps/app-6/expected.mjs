export default {
  doctor: {
    // Токены `XTokenized` для темы `heavy` в этом графе не применяются.
    warnings: { 'component-theme-unknown': 1 },
  },
  purpose: 'собственные режимы приложения вместо light/dark темы',
  css: {
    present: [
      { what: 'режим emerald — первый в наборе, под :root', css: ':root,[data-theme=paper-emerald]' },
      { what: 'режим ocean', css: '[data-theme=paper-ocean]' },
      { what: 'режим crimson', css: '[data-theme=paper-crimson]' },
      { what: 'токен приложения из литерала (emerald)', css: '--app-accent:#10b981' },
      { what: 'токен приложения из CSS-файла (crimson, tokensRef)', css: '--app-accent:#f43f5e' },
      { what: 'унаследованный от light токен провайдерского компонента', css: '--x-tokenized:red' },
      { what: 'класс компонента, использующий токен темы', css: 'var(--x-tokenized)' },
    ],
    absent: [
      { what: 'режим dark темы — его нет в наборе', css: '[data-theme=paper-dark]' },
      { what: 'классов активации нет', css: '.dark' },
      { what: 'CSS невыбранного XTest1', css: '.x-sp-test' },
    ],
  },
  report: (report, check) => {
    check(report.themes.modes.join(',') === 'emerald,ocean,crimson', `modes: ${report.themes.modes}`)
    check(report.themes.modesSource === 'explicit', report.themes.modesSource)
  },
}
