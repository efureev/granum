/**
 * Ожидания пары стендов `app-theme-one-light` и `app-theme-one-dark`: одна кнопка,
 * тема «Камень», один режим. В CSS — токены кнопки и их ссылки со значениями своего
 * режима, и ни пары, ни схемы, ни значений другого режима — ни под каким токеном.
 */
const MODES = {
  light: {
    values: { '--vd-accent': '#57534e', '--vd-accent-fg': '#fff' },
    // Значения, которых нет у другого режима: `#1c1917` есть у обоих, `#fff` — ещё и у preflight.
    unique: ['#57534e'],
  },
  dark: {
    values: { '--vd-accent': '#d6d3d1', '--vd-accent-fg': '#1c1917' },
    unique: ['#d6d3d1', '#292524'],
  },
}

export function themeOneExpected(mode) {
  const other = mode === 'light' ? 'dark' : 'light'
  const pair = `[data-theme=stone-${mode}]`
  return {
    purpose: `один компонент, одна тема, режим ${mode}: токены кнопки и их ссылки со значениями «Камня» в ${mode}, без следа ${other}`,
    doctor: { warnings: {} },
    tokens: {
      what: `ровно токены VdButton и их ссылки, только stone и только ${mode}`,
      layers: ['tokens', 'themes'],
      // Служебные переменные lightningcss для `color-scheme` — не токены дизайн-системы.
      ignore: [/^--lightningcss-/],
      exact: {
        [`@layer granum.tokens :root:not([data-theme]),${pair}`]: { '--vd-radius': '6px' },
        [`@layer granum.themes :where(:root),${pair}`]: {
          '--vd-button-bg': 'var(--vd-accent)',
          '--vd-button-fg': 'var(--vd-accent-fg)',
          '--vd-button-radius': 'var(--vd-radius)',
          ...MODES[mode].values,
        },
      },
    },
    css: {
      present: [{ what: `схема режима ${mode}`, css: `color-scheme:${mode}` }],
      absent: [
        { what: `пары ${other} в сборке нет`, css: `stone-${other}` },
        { what: `схемы ${other} нет`, css: `color-scheme:${other}` },
        ...Object.entries(MODES[other].values).map(([token, value]) => ({ what: `${token} режима ${other}`, css: `${token}:${value}` })),
        ...MODES[other].unique.map(value => ({ what: `значение режима ${other} ни под каким токеном`, css: value })),
        { what: 'других тем каталога в сборке нет', css: 'moss-' },
      ],
    },
    report: (report, check) => {
      check(JSON.stringify(report.themes.themes.map(theme => [theme.id, theme.modes])) === JSON.stringify([['stone', [mode]]]), `темы сборки: ${JSON.stringify(report.themes.themes)}`)
      check(report.prune?.mode === 'on', `обрезка: ${JSON.stringify(report.prune)}`)
      // Значения карточки, группы и роли страницы тема несёт, а кнопка их не читает.
      check(JSON.stringify(report.prune?.removable) === JSON.stringify(['vd-bg', 'vd-card-bg', 'vd-card-pad', 'vd-fg', 'vd-font', 'vd-group-gap']), `вырезано: ${JSON.stringify(report.prune?.removable)}`)
    },
  }
}
