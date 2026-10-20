/** Что app-theme-previews обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
const ACTIVE = ':root,[data-theme=paper-light]{'
const PREVIEW_PAIR = '[data-theme=ink-light]{'
const PREVIEW_FORMULAS = '[data-theme=ink-light],[data-theme=ink-dark],[data-theme=ink-dim]{'

export default {
  purpose: 'превью отдельным листом: блоки ink только на странице, которая их импортирует',
  css: {
    present: [
      { what: 'активная тема paper', css: ACTIVE, layer: 'themes' },
      { what: 'полный блок пары превью', css: PREVIEW_PAIR, layer: 'themes' },
      { what: 'формулы превью под списком её пар', css: PREVIEW_FORMULAS, layer: 'themes' },
    ],
    absent: [
      { what: 'превью под :root', css: ':root,[data-theme=ink-' },
    ],
  },
  pages: (pages, check) => {
    const index = pages['index.html'] ?? ''
    const previews = pages['previews.html'] ?? ''
    check(index.includes(ACTIVE) && previews.includes(ACTIVE), 'обе страницы получают активную тему')
    check(!index.includes(PREVIEW_PAIR) && !index.includes(PREVIEW_FORMULAS), 'обычная страница не платит за превью')
    check(previews.includes(PREVIEW_PAIR) && previews.includes(PREVIEW_FORMULAS), 'страница дизайн-системы получает блоки превью')
    // Лист превью несёт порядок слоёв: подключённый раньше общего, он не меняет каскад.
    check(/@layer granum\.tokens,\s*granum\.base;\s*@layer granum\.themes\s*\{/.test(previews), 'порядок слоёв на странице превью')
  },
  report: (report, check) => {
    check(report.themes.theme === 'paper', `theme: ${report.themes.theme}`)
    check(report.themes.previews.join(',') === 'ink', `previews: ${report.themes.previews}`)
  },
}
