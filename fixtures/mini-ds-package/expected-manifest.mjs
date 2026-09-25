import { existsSync } from 'node:fs'
import { join } from 'node:path'

export default function ({ manifest, distDir, check }) {
  const c = manifest.components
  check(manifest.id === '@granum-fixtures/mini-ds', 'id')
  check(Object.keys(c).join(',') === 'XxBadge,XxCard', `состав: ${Object.keys(c)}`)

  // Фундамент скопирован из зеркального src/styles и объявлен в манифесте.
  for (const path of ['styles/tokens.css', 'styles/base.css', 'styles/themes/light.css', 'styles/themes/dark.css'])
    check(existsSync(join(distDir, path)), `theme file ${path}`)
  check(manifest.theme.defaultThemes.join(',') === 'light', 'defaultThemes')
  check(Object.keys(manifest.theme.themes).sort().join(',') === 'dark,light', 'две темы')

  // Объявленные токены: обе темы и тема-независимый слой, включая мёртвый груз.
  for (const token of ['--xxx-space-1', '--xxx-space-2', '--xxx-radius', '--xxx-font-sm', '--xxx-bg', '--xxx-fg', '--xxx-line', '--xxx-accent', '--xxx-accent-fg', '--xxx-muted'])
    check(manifest.theme.declares.includes(token), `declares ${token}`)

  // Классов мало и они поимённо известны — на этом стоит стенд аудита.
  check(c.XxCard.classes.join(' ') === 'p-[var(--xxx-space-2)] rounded-[var(--xxx-radius)]', `XxCard.classes: ${c.XxCard.classes}`)
  check(c.XxBadge.classes.join(' ') === 'bg-[var(--xxx-accent)] inline-block px-[var(--xxx-space-1)] text-[var(--xxx-accent-fg)]', `XxBadge.classes: ${c.XxBadge.classes}`)

  // `.xxx-card` — собственный CSS карточки; у бейджа своего CSS нет вовсе.
  check(c.XxCard.css.join(',') === 'components/XxCard/styles.css', `XxCard.css: ${c.XxCard.css}`)
  check(c.XxBadge.css.length === 0, `XxBadge.css: ${c.XxBadge.css}`)

  // Потребление: карточка берёт линию и поверхность, бейдж — акцентную пару.
  check(c.XxCard.tokens.consumes.join(' ') === '--xxx-bg --xxx-fg --xxx-line --xxx-radius --xxx-space-2', `XxCard.consumes: ${c.XxCard.tokens.consumes}`)
  check(c.XxBadge.tokens.consumes.join(' ') === '--xxx-accent --xxx-accent-fg --xxx-space-1', `XxBadge.consumes: ${c.XxBadge.tokens.consumes}`)

  // Граф пустой: компоненты независимы, и селекция одного не тянет второй.
  check(c.XxCard.dependencies.length === 0 && c.XxBadge.dependencies.length === 0, 'зависимостей нет')
  check(manifest.warnings.length === 0, `warnings: ${JSON.stringify(manifest.warnings)}`)
}
