export default {
  purpose: 'собственные темы приложения вместо провайдерских light/dark',
  css: {
    present: [
      { what: 'блок темы emerald', css: '[data-theme=emerald]' },
      { what: 'блок темы ocean', css: '[data-theme=ocean]' },
      { what: 'блок темы crimson', css: '[data-theme=crimson]' },
      { what: 'токен приложения из литерала (emerald)', css: '--app-accent:#10b981' },
      { what: 'токен приложения из CSS-файла (crimson, tokensRef)', css: '--app-accent:#e11d48' },
      { what: 'унаследованный от light токен провайдерского компонента', css: '--x-tokenized:red' },
      { what: 'класс компонента, использующий токен темы', css: 'var(--x-tokenized)' },
    ],
    absent: [
      { what: 'блок темы dark провайдера', css: '[data-theme=dark]' },
      { what: 'класс-активация dark провайдера', css: '.theme-dark' },
      { what: 'CSS невыбранного XTest1', css: '.x-sp-test' },
    ],
  },
  report: (report, check) => {
    check(report.themes.names.join(',') === 'emerald,ocean,crimson', `themes: ${report.themes.names}`)
    check(report.themes.namesSource === 'app-defined', report.themes.namesSource)
  },
}
