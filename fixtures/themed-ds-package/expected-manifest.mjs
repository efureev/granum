export default function ({ manifest, check }) {
  const c = manifest.components
  check(manifest.id === '@granum-fixtures/themed-ds', 'id')
  check(manifest.dependencies.join(',') === '@granum-fixtures/themes', `dependencies: ${manifest.dependencies}`)
  check(manifest.theme.catalog === undefined, 'своего каталога нет')
  check(Object.keys(c).join(',') === 'TdBadge,TdButton,TdCard', `состав: ${Object.keys(c)}`)

  // themesDir материализован в манифест по темам и режимам (C-33).
  const button = c.TdButton.tokens.themes
  check(Object.keys(button).join(',') === 'ink,paper', `TdButton.themes: ${Object.keys(button)}`)
  check(Object.keys(button.paper.modes).sort().join(',') === 'dark,light', 'paper: light и dark')
  check(button.paper.modes.light['td-button-bg'] === 'var(--th-accent)', 'paper.light.td-button-bg')
  check(button.paper.modes.dark['td-button-shadow'] === 'none', 'paper.dark: только отличие')
  check(Object.keys(button.ink.modes).join(',') === 'light' && button.ink.root === undefined, 'ink: только light')
  check(c.TdCard.tokens.themes.paper.root['td-card-pad'] === '12px', 'TdCard: root.json')
  check(c.TdBadge.tokens.themes === undefined, 'TdBadge без themesDir')

  // Хук бейджа со значением по умолчанию извне не требуется (T-5); роль внутри значения по умолчанию — требуется.
  check(c.TdBadge.tokens.requires.join(' ') === '--th-accent --th-accent-fg', `TdBadge.requires: ${c.TdBadge.tokens.requires}`)
  // Сам хук читается только через запасное значение и объявлен хуком.
  check(c.TdBadge.tokens.optional?.join(' ') === '--td-badge-bg', `TdBadge.optional: ${c.TdBadge.tokens.optional}`)
  check(c.TdBadge.tokens.hooks?.join(' ') === '--td-badge-bg', `TdBadge.hooks: ${c.TdBadge.tokens.hooks}`)
  check(manifest.warnings.length === 0, `warnings: ${JSON.stringify(manifest.warnings)}`)
}
