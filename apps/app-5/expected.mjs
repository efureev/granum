export default {
  purpose: 'две темы в CSS и манифест тем для рантайма',
  css: {
    present: [
      { what: 'блок токенов light под :root', css: ':root{--x-tokenized:red}' },
      { what: 'блок токенов dark — уже в CSS', css: '--x-tokenized:yellow' },
      { what: 'селектор активации dark, обещанный манифестом', css: '[data-theme=dark]' },
      { what: 'класс компонента, использующий токен темы', css: 'var(--x-tokenized)' },
    ],
    absent: [
      { what: 'CSS невыбранного XTest1', css: '.x-sp-test' },
    ],
  },
  js: {
    present: [
      { what: 'манифест тем доехал до бандла', js: 'defaultTheme' },
      { what: 'активация dark в манифесте', js: 'data-theme' },
    ],
  },
  report: (report, check) => {
    check(report.themes.names.join(',') === 'light,dark', `themes: ${report.themes.names}`)
    check(report.themes.namesSource === 'explicit', report.themes.namesSource)
  },
}
