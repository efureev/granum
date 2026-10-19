export default {
  doctor: {
    // `XTokenized` кладёт токены и для темы `heavy` другого каталога: в этом
    // графе её нет, и доктор называет папку, которая не применится (C-36).
    warnings: { 'component-theme-unknown': 1 },
  },
  purpose: 'два режима темы в CSS и манифест тем для рантайма',
  css: {
    present: [
      { what: 'режим по умолчанию под :root и своей парой', css: ':root,[data-theme=paper-light]{' },
      { what: 'color-scheme в блоке режима', css: 'color-scheme:light;--th-accent:#2563eb' },
      { what: 'токен компонента для light', css: '--x-tokenized:red' },
      { what: 'токен компонента для dark — уже в CSS', css: '--x-tokenized:yellow' },
      { what: 'пара тёмного режима, обещанная манифестом', css: '[data-theme=paper-dark]' },
      { what: 'класс компонента, использующий токен темы', css: 'var(--x-tokenized)' },
    ],
    absent: [
      { what: 'CSS невыбранного XTest1', css: '.x-sp-test' },
    ],
  },
  js: {
    present: [
      { what: 'манифест тем доехал до бандла', js: 'defaultMode' },
      { what: 'пара тёмного режима в манифесте', js: 'paper-dark' },
    ],
  },
  report: (report, check) => {
    check(report.themes.theme === 'paper' && report.themes.themeSource === 'default', `theme: ${report.themes.theme} (${report.themes.themeSource})`)
    check(report.themes.modes.join(',') === 'light,dark', `modes: ${report.themes.modes}`)
    check(report.themes.modesSource === 'explicit', report.themes.modesSource)
  },
}
