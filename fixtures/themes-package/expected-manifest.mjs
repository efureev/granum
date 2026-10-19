import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export default function ({ manifest, distDir, check }) {
  const theme = manifest.theme
  check(manifest.id === '@granum-fixtures/themes', 'id')
  check(manifest.granum === 3 && manifest.contractVersion === 2, `формат ${manifest.granum}, контракт ${manifest.contractVersion}`)
  check(Object.keys(manifest.components).length === 0, 'компонентов нет — владелец тем без компонентов (C-32)')
  check(theme.defaultTheme === 'paper', `defaultTheme: ${theme.defaultTheme}`)
  check(theme.registry === 'themes/registry.json', `registry: ${theme.registry}`)
  check(theme.tokensCss === 'styles/tokens.css', `tokensCss: ${theme.tokensCss}`)

  // Индекс каталога: режимы по умолчанию первыми, без чтения данных (C-29).
  check(Object.keys(theme.catalog).join(',') === 'ink,paper', `каталог: ${Object.keys(theme.catalog)}`)
  check(theme.catalog.paper.modes.join(',') === 'light,dark', `paper.modes: ${theme.catalog.paper.modes}`)
  check(theme.catalog.ink.modes.join(',') === 'light,dark,dim', `ink.modes: ${theme.catalog.ink.modes}`)
  check(theme.catalog.ink.extends === 'paper' && theme.catalog.ink.defaultMode === 'light', 'ink extends paper')
  check(theme.catalog.paper.docs === 'https://example.com/themes/paper', 'docs')

  // `ink` в dist — полные данные: отличия слиты с `paper` сборкой (C-27, B-10).
  const ink = JSON.parse(readFileSync(join(distDir, theme.catalog.ink.data), 'utf8'))
  check(ink.id === 'ink' && ink.title === 'Чернила', `ink: ${ink.id}/${ink.title}`)
  check(ink.root['th-font'] === 'Georgia, serif' && ink.root['th-ring'] === '0 0 0 2px var(--th-accent)', 'ink.root: свои и унаследованные')
  check(ink.modes.light.tokens['th-accent'] === '#111827' && ink.modes.light.tokens['th-bg'] === '#ffffff', 'ink.light: отличие поверх paper.light')
  check(ink.modes.dark.tokens['th-bg'] === '#0f172a', 'ink.dark целиком из paper')
  check(ink.modes.dim.extends === 'dark' && ink.modes.dim.colorScheme === 'dark', 'ink.dim extends dark')
  check(ink.extensions?.fixture?.density === 'comfortable', 'extensions унаследованы')

  // declares: реестр, все темы каталога и tokensCss (C-31).
  for (const token of ['--th-bg', '--th-radius', '--th-ring', '--th-shade', '--th-accent-soft'])
    check(theme.declares.includes(token), `declares ${token}`)
  check(manifest.engine.dialect === null, 'словаря нет: классов нет')
  check(manifest.warnings.length === 0, `warnings: ${JSON.stringify(manifest.warnings)}`)
}
