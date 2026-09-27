/**
 * Что стенд серверного рендера обязан отдавать. Проверяется
 * `node scripts/verify-ssr.mjs`.
 */
export default {
  purpose: 'серверный рендер: тему выбирает сервер, клиент её не переизбирает, CSS один ассет со слоями',

  themes: ['light', 'dark'],

  /** URL, которые рендерим. */
  render: {
    light: '/',
    dark: '/?theme=dark',
    // Имени нет в манифесте — активировать нечего, и granum не должен отдать
    // страницу без токенов: сервер откатывается к теме по умолчанию.
    unknown: '/?theme=nope',
  },

  expectRender: {
    light: {
      theme: 'light',
      // Тема с активацией `root` не пишет на корень ничего: её токены под
      // `:root`, и она активна, пока не активирована другая.
      rootTag: '<html lang="ru">',
      // Активная тема отражена в разметке, и это та же строка, которую увидит
      // клиент при гидрации: разойтись им нельзя. Имена всех тем есть в
      // подписях кнопок, поэтому маркер именно у активной.
      html: ['x-sp-test', 'xh-card', 'x-tokenized', 'data-active-theme>light<'],
      htmlAbsent: ['data-active-theme>dark<'],
    },
    dark: {
      theme: 'dark',
      rootTag: '<html lang="ru" data-theme="dark">',
      html: ['x-sp-test', 'xh-card', 'x-tokenized', 'data-active-theme>dark<'],
      htmlAbsent: ['data-active-theme>light<'],
    },
    unknown: {
      theme: 'light',
      rootTag: '<html lang="ru">',
      html: ['data-active-theme>light<'],
    },
  },

  css: {
    /**
     * Порядок блоков и есть порядок каскада: когда непусты все пять слоёв,
     * отдельной строки `@layer a, b, c;` в выводе нет.
     */
    layerOrder: ['tokens', 'base', 'themes', 'components', 'utilities'],
    present: [
      { what: 'CSS компонента XTest1, пришедшего замыканием графа', css: '.x-sp-test' },
      { what: 'токен темы light структурного определения', css: '--x-tokenized:red' },
      { what: 'токен темы dark — обе темы в CSS сразу', css: '--x-tokenized:yellow' },
      { what: 'селектор активации dark, обещанный манифестом', css: '[data-theme=dark]' },
      { what: 'класс, который есть только в разметке приложения', css: 'color:var(--x-tokenized)' },
    ],
    absent: [
      { what: 'CSS невыбранного XhButton', css: '--xh-btn-bg' },
      { what: 'классы невыбранного XTestStyled', css: '--card-fg' },
      { what: 'директив @apply в выводе нет', css: '@apply' },
    ],
  },

  doctor: {
    // `--brd` компоненту даёт приложение: фикстура объявляет только форму
    // границы, цвет — дело потребителя. Здесь его нет, и доктор честно говорит.
    warnings: { 'token-undefined': 1 },
  },

  report: (report, check) => {
    check(
      report.selection.map(s => s.key.split(':').pop()).join(',') === 'XTest1,XgQuick,XhCard,XTokenized',
      `селекция: ${report.selection.map(s => s.key)}`,
    )
    check(report.themes.namesSource === 'explicit', `источник списка тем: ${report.themes.namesSource}`)
    check(report.classes.unmatched.length === 0, `классы без правила: ${JSON.stringify(report.classes.unmatched)}`)
    // Обрезка включена и что-то сняла, но токен, до которого достаёт только
    // разметка приложения, остался: серверный рендер её не обманывает.
    check(report.prune?.mode === 'on', `режим обрезки: ${report.prune?.mode}`)
    check(report.prune.removable.length > 0, 'обрезка не сняла ни одного токена')
    check(!report.prune.removable.includes('--x-tokenized'), 'обрезка сняла токен, который держит разметка приложения')
  },
}
