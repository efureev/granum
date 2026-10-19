export default function ({ manifest, check }) {
  const chart = manifest.components.TcChart
  check(manifest.id === '@granum-fixtures/themed-companion', 'id')
  check(manifest.dependencies.join(',') === '@granum-fixtures/themed-ds', `dependencies: ${manifest.dependencies}`)
  // Сборка провайдера каталога графа не знает: чужие и неизвестные темы она записывает как есть.
  check(Object.keys(chart.tokens.themes).join(',') === 'ink,unknown', `TcChart.themes: ${Object.keys(chart.tokens.themes)}`)
  check(chart.tokens.themes.ink.modes.dark['tc-chart-grid'] === '#374151', 'ink.dark')
  check(manifest.warnings.length === 0, `warnings: ${JSON.stringify(manifest.warnings)}`)
}
