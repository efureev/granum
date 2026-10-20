/** Что app-theme-sheets обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
const MAIN = ':where(:root),[data-theme=paper-light]{'
const PAIR = '[data-theme=ink-light]{'
const FORMULAS = '[data-theme=ink-light],[data-theme=ink-dark],[data-theme=ink-dim]{'

export default {
  purpose: 'дополнительная тема своим листом: блоки ink — только в её листе, адрес ассета — в манифесте',
  css: {
    present: [
      { what: 'основная тема paper', css: MAIN, layer: 'themes' },
      { what: 'полный блок пары дополнительной темы', css: PAIR, layer: 'themes' },
      { what: 'формулы дополнительной темы под списком её пар', css: FORMULAS, layer: 'themes' },
    ],
    absent: [
      { what: 'дополнительная тема под :root', css: ':root,[data-theme=ink-' },
      { what: 'граница общих формул по наличию атрибута', css: ':root,[data-theme]{', layer: 'themes' },
    ],
  },
  js: {
    present: [{ what: 'адрес ассета листа ink в манифесте', js: 'granum-theme-ink-' }],
    absent: [{ what: 'адрес листа у основной темы', js: 'granum-theme-paper-' }],
  },
  pages: (pages, check) => {
    const index = pages['index.html'] ?? ''
    const previews = pages['previews.html'] ?? ''
    check(index.includes(MAIN) && previews.includes(MAIN), 'обе страницы получают основную тему')
    check(!index.includes(PAIR) && !index.includes(FORMULAS), 'обычная страница не платит за дополнительную тему')
    check(previews.includes(PAIR) && previews.includes(FORMULAS), 'страница дизайн-системы получает лист ink')
    // Лист несёт порядок слоёв: подключённый раньше общего, он не меняет каскад.
    check(/@layer granum\.tokens,\s*granum\.base[^;]*;\s*@layer granum\.themes\s*\{/.test(previews), 'порядок слоёв на странице с листом ink')
  },
  report: (report, check) => {
    check(report.themes.defaultTheme === 'paper', `defaultTheme: ${report.themes.defaultTheme}`)
    check(report.themes.themes.map(theme => theme.id).join(',') === 'paper,ink', `themes: ${report.themes.themes.map(theme => theme.id)}`)
  },
}
