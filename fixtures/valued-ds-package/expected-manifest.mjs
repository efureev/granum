import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DS = '@granum-fixtures/valued-ds'

export default function ({ manifest, distDir, check }) {
  const c = manifest.components
  const catalog = manifest.theme.catalog
  const data = id => JSON.parse(readFileSync(join(distDir, `themes/${id}.json`), 'utf8'))
  check(manifest.id === DS, 'id')
  check(manifest.version === '1.0.0', `version: ${manifest.version}`)
  // Основную тему выбирает приложение: у каталога её нет.
  check(manifest.theme.defaultTheme === undefined, `defaultTheme: ${manifest.theme.defaultTheme}`)
  check(Object.keys(catalog).join(',') === 'ember,moss,stone', `каталог: ${Object.keys(catalog)}`)

  // Индекс каталога из theme.json исходников (C-43): версия и целевые пакеты темы.
  for (const id of ['stone', 'moss', 'ember']) {
    check(catalog[id].version === '1.0.0', `${id}.version: ${catalog[id].version}`)
    check(catalog[id].targets?.[DS] === '^1.0.0', `${id}.targets: ${JSON.stringify(catalog[id].targets)}`)
    check(catalog[id].data === `themes/${id}.json`, `${id}.data: ${catalog[id].data}`)
  }
  check(catalog.ember.extends === 'stone', 'ember наследует stone')
  check(catalog.moss.extends === undefined, 'moss — копия, не наследник')
  check(catalog.stone.title === 'Камень' && catalog.moss.title === 'Мох' && catalog.ember.title === 'Угли', 'названия из theme.json')

  // Значения раздела в dist ещё и слиты в root/modes (C-44); раздел — индекс принадлежности.
  const stone = data('stone')
  check(stone.modes.light.tokens['vd-button-bg'] === 'var(--vd-accent)', 'stone: значение кнопки слито в режим')
  check(stone.modes.dark.tokens['vd-card-bg'] === '#292524', 'stone: значение карточки слито в режим')
  check(stone.root['vd-button-radius'] === 'var(--vd-radius)', 'stone: корень кнопки слит в root')
  check(Object.keys(stone.components?.[DS] ?? {}).join(',') === 'VdButton,VdCard,VdGroup', `stone: раздел ${JSON.stringify(Object.keys(stone.components?.[DS] ?? {}))}`)

  // Наследник: свои отличия поверх stone, значения кнопки — тоже по разделу.
  const ember = data('ember')
  check(ember.modes.dark.tokens['vd-accent'] === '#ea580c', 'ember: свой акцент')
  check(ember.modes.dark.tokens['vd-button-fg'] === '#1c0f0a', 'ember: своё значение кнопки')
  check(ember.modes.light.tokens['vd-accent'] === '#57534e', 'ember: светлый режим — от stone')
  check(ember.components[DS].VdCard.modes.dark['vd-card-bg'] === '#292524', 'ember: раздел карточки — от stone')

  // Копия: правки свои, связи со stone нет.
  const moss = data('moss')
  check(moss.root['vd-radius'] === '10px' && moss.modes.light.tokens['vd-accent'] === '#3f6212', 'moss: свои правки')
  check(moss.components[DS].VdCard.modes.light['vd-card-bg'] === '#f7fee7', 'moss: своё значение карточки')

  // Виды токенов: тема даёт требования извне; хук и то, что кнопка ставит сама, — нет.
  check(c.VdButton.tokens.requires.join(' ') === '--vd-button-bg --vd-button-fg --vd-button-radius', `VdButton.requires: ${c.VdButton.tokens.requires}`)
  check(c.VdButton.tokens.hooks?.join(' ') === '--vd-button-shadow', `VdButton.hooks: ${c.VdButton.tokens.hooks}`)
  check(c.VdButton.tokens.consumes.includes('--vd-button-gap') && !c.VdButton.tokens.requires.includes('--vd-button-gap'), 'зазор кнопка ставит сама')
  check(c.VdGroup.tokens.requires.includes('--vd-button-radius'), 'группа требует радиус кнопки')
  check(c.VdGroup.dependencies.join(',') === 'VdButton', `VdGroup.dependencies: ${c.VdGroup.dependencies}`)
  check(manifest.warnings.length === 0, `warnings: ${JSON.stringify(manifest.warnings)}`)
}
