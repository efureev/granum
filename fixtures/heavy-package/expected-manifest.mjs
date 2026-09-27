import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export default function ({ manifest, distDir, check }) {
  const c = manifest.components
  check(manifest.id === '@granum-fixtures/heavy', 'id')
  // Фундамент скопирован из зеркального src/theme и объявлен в манифесте (§6.3).
  for (const path of ['theme/tokens.css', 'theme/base.css', 'theme/light.css', 'theme/dark.css'])
    check(existsSync(join(distDir, path)), `theme file ${path}`)
  check(manifest.theme.defaultThemes.join(',') === 'light', 'defaultThemes')
  // Объявленные токены — полный скан, включая блоки внутри @supports.
  check(manifest.theme.declares.includes('--xh-accent-hover') && manifest.theme.declares.includes('--xh-space-2') && manifest.theme.declares.includes('--xh-elevated-fg'), `declares: ${manifest.theme.declares.length}`)

  // Граф: XhPanel объявляет всех, кого импортирует (INV-CON-5); общий модуль overlayZ ребром не является (INV-CON-6).
  check(c.XhPanel.dependencies.join(',') === 'XhAlert,XhButton,XhCard,XhOverlay', `XhPanel.deps: ${c.XhPanel.dependencies}`)
  check(c.XhOverlay.dependencies.length === 0, 'XhOverlay has no deps')
  // Файлы компонента — только его директория и общие чанки; чанки чужих
  // компонентов, до которых бандлер дотягивается напрямую, — рёбра, а не файлы.
  check(c.XhPanel.files.every(f => f.startsWith('components/XhPanel/') || f.startsWith('chunks/')), `XhPanel.files: ${c.XhPanel.files}`)
  check(c.XhOverlay.files.every(f => f.startsWith('components/XhOverlay/') || f.startsWith('chunks/')), `XhOverlay.files: ${c.XhOverlay.files}`)

  // Токены: var() в шаблонах и CSS, литералы в JS, dynamicTokens (B-9).
  check(c.XhCard.tokens.consumes.includes('--xh-card-bg') && c.XhCard.tokens.consumes.includes('--xh-space-2'), `XhCard.consumes: ${c.XhCard.tokens.consumes}`)
  check(c.XhAlert.tokens.consumes.includes('--xh-alert-duration') && c.XhAlert.tokens.consumes.includes('--xh-blue-100'), `XhAlert.consumes: ${c.XhAlert.tokens.consumes}`)
  check(c.XhOverlay.tokens.dynamic.join(',') === '--xh-z-dropdown', `XhOverlay.dynamic: ${c.XhOverlay.tokens.dynamic}`)
  check(c.XhPanel.tokens.consumes.includes('--xh-elevated-fg') && c.XhPanel.tokens.consumes.includes('--xh-space-2'), `XhPanel.consumes: ${c.XhPanel.tokens.consumes}`)
  // Имя токена лежит литералом в общем модуле, который бандлер положил в чанк XhOverlay.
  check(c.XhOverlay.tokens.consumes.includes('--xh-z-dropdown'), `XhOverlay.consumes: ${c.XhOverlay.tokens.consumes}`)

  // Группа data: общий SFC в groups/data/shared/, классы общего SFC у обоих членов.
  for (const name of ['XhTable', 'XhList']) {
    check(c[name].group === 'data' && c[name].files.some(f => f.startsWith('groups/data/shared/')), `${name}.files: ${c[name].files}`)
    check(c[name].classes.includes('px-[var(--xh-space-3)]'), `${name}.classes: ${c[name].classes}`)
  }
  check(c.XhList.classes.includes('divide-y') && c.XhTable.classes.includes('odd:bg-[var(--xh-table-stripe)]'), 'group member own classes')

  // Safelist: собранные в рантайме классы, включая намеренно мёртвый `shadow-legacy` (INV-CON-4).
  check(c.XhButton.safelist.includes('shadow-legacy') && c.XhButton.safelist.includes('p-2'), `XhButton.safelist: ${c.XhButton.safelist}`)
  // Запись safelist, которую извлечение и так нашло, в манифест не едет (C-8):
  // CSS от неё не зависит, а манифест от неё пухнет. Класс тона лежит в чанке
  // литералом, поэтому статика его видит — и в safelist его больше нет.
  check(!c.XhButton.safelist.includes('bg-[var(--xh-btn-bg)]'), `XhButton.safelist: ${c.XhButton.safelist}`)
  check(c.XhButton.classes.includes('bg-[var(--xh-btn-bg)]'), `XhButton.classes: ${c.XhButton.classes}`)
  // Предупреждения `safelist-redundant` больше нет: раскладку чанков, от которой
  // зависит видимость класса, выбирает бандлер, а не автор пакета.
  check(!manifest.warnings.some(w => w.code === 'safelist-redundant'), `warnings: ${JSON.stringify(manifest.warnings)}`)
  // CSS: объявленный файл и стили SFC.
  check(c.XhPanel.css.includes('components/XhPanel/styles.css'), `XhPanel.css: ${c.XhPanel.css}`)
  check(c.XhCard.css.some(p => p.startsWith('components/XhCard/')) && readFileSync(join(distDir, c.XhCard.css[0]), 'utf8').includes('.xh-card'), `XhCard.css: ${c.XhCard.css}`)
}
