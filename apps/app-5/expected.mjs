export default {
  doctor: {
    // `XTokenized` кладёт токены и для темы `heavy` другого каталога: в этом
    // графе её нет, и доктор называет папку, которая не применится.
    warnings: { 'component-theme-unknown': 1 },
  },
  purpose: 'два режима темы в CSS и манифест тем для рантайма',
  css: {
    present: [
      { what: 'режим по умолчанию под :where(:root) и своей парой', css: ':where(:root),[data-theme=paper-light]{' },
      { what: 'color-scheme в блоке режима', css: 'color-scheme:light;--th-accent:#2563eb' },
      { what: 'токен компонента для light', css: '--x-tokenized:red' },
      { what: 'токен компонента для dark — уже в CSS', css: '--x-tokenized:yellow' },
      { what: 'пара тёмного режима, обещанная манифестом', css: '[data-theme=paper-dark]' },
      { what: 'класс компонента, использующий токен темы', css: 'var(--x-tokenized)' },
      // `system: 'media'`: корень без атрибута при тёмной схеме — тёмный режим.
      { what: 'тёмный режим по системной схеме для корня без атрибута', css: '@media (prefers-color-scheme:dark){:root:not([data-theme]){' },
      // Только здесь фолбэк стоит под одним корнем без атрибута: он вложен в
      // медиазапрос. `th-shade` тёмный берёт из светлого вместе с фолбэком.
      { what: 'фолбэк тёмного режима внутри медиазапроса', css: '{:root:not([data-theme]){--th-shade:#eee}}}' },
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
    check(report.themes.defaultTheme === 'paper' && report.themes.themeSource === 'provider', `theme: ${report.themes.defaultTheme} (${report.themes.themeSource})`)
    check(report.themes.themes[0]?.modes.join(',') === 'light,dark', `modes: ${report.themes.themes[0]?.modes}`)
    check(report.themes.themes[0]?.modesSource === 'explicit', report.themes.themes[0]?.modesSource)
  },
}
