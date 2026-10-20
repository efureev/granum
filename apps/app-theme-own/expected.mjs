/** Что app-theme-own обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
export default {
  purpose: 'тема-объект приложения поверх paper: свои токены компонента, режим define, override корня',
  doctor: {
    // Папка `themes/unknown/` спутника — тема, которой нет ни в одном каталоге.
    // `--tc-chart-label` спутник читает только через запасное значение и хуком не
    // объявил — намеренная находка: так виден переименованный или забытый токен.
    warnings: { 'component-theme-unknown': 1, 'token-fallback-only': 1 },
  },
  css: {
    present: [
      { what: 'режим по умолчанию темы приложения', css: ':root,[data-theme=brand-light]{' },
      { what: 'свой токен кнопки перекрыл токен компонента', css: '--td-button-shadow:0 0 0 2px #7c3aed' },
      { what: 'в тёмном режиме — токен компонента paper по цепочке extends', css: '--td-button-shadow:none' },
      { what: 'режим приложения sepia своей парой', css: '[data-theme=brand-sepia]{' },
      { what: 'значение sepia', css: '--th-bg:#f4ecd8' },
      { what: 'override корня — в слое tokens', css: '--th-font:Inter, sans-serif' },
      { what: 'свой литерал корня', css: '--th-radius:10px' },
    ],
    absent: [
      { what: 'пары темы каталога', css: 'paper-' },
    ],
  },
  report: (report, check) => {
    check(report.themes.theme === 'brand' && report.themes.themeSource === 'app', `theme: ${report.themes.theme} (${report.themes.themeSource})`)
    check(report.themes.modes.join(',') === 'light,dark,sepia', `modes: ${report.themes.modes}`)
  },
}
