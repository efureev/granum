/** Что app-theme-values обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
const MAIN = ':where(:root),[data-theme=stone-light]{'

/** Значение токена в паре `<тема>-<режим>`; `undefined` — токена в блоке пары нет. */
const pair = (theme, mode, values, what) => Object.entries(values).map(([token, value]) => ({ what, selector: `[data-theme=${theme}-${mode}]`, token: `--${token}`, value }))

export default {
  purpose: 'значения компонентов у темы: базовая тема пакета, копия, наследник, тема из отдельного пакета и своя тема приложения',
  // Полнота, принадлежность значений и целевые пакеты — без находок: `doctor` чистый.
  doctor: { warnings: {} },
  css: {
    present: [
      { what: 'основная тема stone — в общем листе', css: MAIN, layer: 'themes' },
      { what: 'значение кнопки у stone — из раздела темы', css: '--vd-button-bg:var(--vd-accent)' },
      { what: 'копия moss: свой акцент', css: '--vd-accent:#3f6212' },
      { what: 'копия moss: своё значение карточки', css: '--vd-card-bg:#f7fee7' },
      { what: 'наследник ember: своё значение кнопки в тёмном режиме', css: '--vd-button-fg:#1c0f0a' },
      { what: 'пакет темы tide: своё значение карточки', css: '--vd-card-bg:#ecfeff' },
      { what: 'своя тема reef поверх moss', css: '[data-theme=reef-light]{' },
      { what: 'reef: свой акцент', css: '--vd-accent:#be123c' },
    ],
    absent: [
      { what: 'тень кнопки — хук: тема её не задаёт', css: '--vd-button-shadow:' },
      { what: 'reef собран только со светлым режимом', css: '[data-theme=reef-dark]' },
    ],
  },
  values: [
    ...pair('stone', 'light', { 'vd-accent': '#57534e', 'vd-radius': '6px', 'vd-card-bg': '#f5f5f4', 'vd-button-bg': 'var(--vd-accent)' }, 'stone: свои значения и значения компонентов из разделов'),
    ...pair('stone', 'dark', { 'vd-accent': '#d6d3d1', 'vd-card-bg': '#292524' }, 'stone: тёмный режим'),
    ...pair('moss', 'light', { 'vd-accent': '#3f6212', 'vd-radius': '10px', 'vd-card-bg': '#f7fee7', 'vd-card-pad': '12px' }, 'moss: правки копии и скопированное'),
    ...pair('moss', 'dark', { 'vd-accent': '#bef264', 'vd-card-bg': '#292524' }, 'moss: тёмный режим копии'),
    ...pair('ember', 'light', { 'vd-accent': '#57534e', 'vd-card-bg': '#f5f5f4' }, 'ember: светлый режим целиком от stone'),
    ...pair('ember', 'dark', { 'vd-accent': '#ea580c', 'vd-bg': '#1c0f0a', 'vd-button-fg': '#1c0f0a', 'vd-card-bg': '#292524' }, 'ember: свои отличия в тёмном, остальное от stone'),
    ...pair('tide', 'light', { 'vd-accent': '#0e7490', 'vd-card-bg': '#ecfeff', 'vd-radius': '6px' }, 'tide: свои значения поверх stone'),
    ...pair('tide', 'dark', { 'vd-accent-fg': '#083344', 'vd-card-bg': '#292524' }, 'tide: тёмный режим — карточка от stone'),
    ...pair('reef', 'light', { 'vd-accent': '#be123c', 'vd-radius': '10px', 'vd-card-bg': '#f7fee7', 'vd-button-shadow': undefined }, 'reef: свой акцент, остальное от moss, а не от stone'),
  ],
  report: (report, check) => {
    const themes = Object.fromEntries(report.themes.themes.map(theme => [theme.id, theme]))
    check(report.themes.defaultTheme === 'stone', `основная тема: ${report.themes.defaultTheme}`)
    check(Object.keys(themes).join(',') === 'stone,moss,ember,tide,reef', `темы сборки: ${Object.keys(themes)}`)
    check(themes.stone.version === '1.0.0' && themes.tide.version === '2.1.0', `версии: stone ${themes.stone.version}, tide ${themes.tide.version}`)
    check(themes.reef.version === undefined, 'у своей темы версии нет: версия родителя — не её')
    for (const id of ['stone', 'moss', 'ember', 'tide', 'reef'])
      check(themes[id].targets?.[0]?.status === 'match', `${id}: targets ${JSON.stringify(themes[id].targets)}`)
  },
}
