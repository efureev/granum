/** Что app-theme-switch обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
const MAIN = ':where(:root),[data-theme=paper-light]{'

export default {
  purpose: 'переключение тем и режимов: две темы пакета и своя, дополнительные — листами по требованию, выбор — до первого кадра',
  css: {
    present: [
      { what: 'основная тема paper — в общем листе', css: MAIN, layer: 'themes' },
      { what: 'лист ink: пара режима «Сумерки»', css: '[data-theme=ink-dim]{' },
      { what: 'лист sand: тёмная пара своей темы', css: '[data-theme=sand-dark]{' },
    ],
    absent: [
      { what: 'дополнительная тема ink под :root', css: ':root,[data-theme=ink-' },
      { what: 'дополнительная тема sand под :root', css: ':root,[data-theme=sand-' },
    ],
  },
  // Листы дополнительных тем страница не подключает: их грузит контроллер, когда тему выбирают.
  pages: (pages, check) => {
    const index = pages['index.html'] ?? ''
    check(index.includes(MAIN), 'страница получает основную тему')
    check(!index.includes('[data-theme=ink-') && !index.includes('[data-theme=sand-'), 'страница не платит за листы дополнительных тем, пока их не выбрали')
  },
  html: {
    present: [
      { what: 'скрипт до первого кадра знает адрес листа ink', html: 'ink:"/app-theme-switch/assets/granum-theme-ink-' },
      { what: 'скрипт до первого кадра знает адрес листа sand', html: 'sand:"/app-theme-switch/assets/granum-theme-sand-' },
    ],
    absent: [
      { what: 'ссылка на лист дополнительной темы в HTML — её ставит рантайм', html: '<link rel="stylesheet" crossorigin href="/app-theme-switch/assets/granum-theme-' },
    ],
  },
  js: {
    present: [
      { what: 'манифест тем: адрес листа ink', js: 'granum-theme-ink-' },
      { what: 'манифест тем: адрес листа sand', js: 'granum-theme-sand-' },
    ],
  },
  report: (report, check) => {
    check(report.themes.defaultTheme === 'paper', `основная тема: ${report.themes.defaultTheme}`)
    check(report.themes.themes.map(theme => `${theme.id}[${theme.modes}]`).join(' ') === 'paper[light,dark] ink[light,dark,dim] sand[light,dark]', `темы сборки: ${report.themes.themes.map(theme => theme.id)}`)
  },
}
