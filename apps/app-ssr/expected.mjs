/**
 * Что стенд серверного рендера обязан отдавать. Проверяется
 * `node scripts/verify-ssr.mjs`.
 */
export default {
  purpose: 'серверный рендер: режим выбирает сервер парой на корне, клиент её не переизбирает, CSS один ассет со слоями',

  /** Тема сборки и её режимы с парами — манифест `virtual:granum/themes`. */
  theme: 'heavy',
  modes: { light: 'heavy-light', dark: 'heavy-dark' },

  /**
   * Провайдеры, которые серверный бандл грузит из node_modules. Granum у
   * приложения — devDependency, и после `--omit=dev` его нет: `dist` провайдера
   * обязан обходиться без него.
   */
  externalProviders: ['@granum-fixtures/extra-simple', '@granum-fixtures/simple', '@granum-fixtures/heavy'],

  /** Запросы, которые рендерим: URL и, где нужно, заголовок `Cookie`. */
  render: {
    light: { url: '/' },
    dark: { url: '/?mode=dark' },
    // Режим из cookie — выбор пользователя прошлых визитов (RT-4).
    cookie: { url: '/', cookie: 'a=1; granum-theme=dark' },
    // Имени нет в манифесте — блоков под него нет, и granum не должен отдать
    // страницу без токенов: сервер откатывается к режиму по умолчанию.
    unknown: { url: '/?mode=nope' },
  },

  expectRender: {
    light: {
      mode: 'light',
      // Пара пишется и для режима по умолчанию: клиент читает её обратно.
      rootTag: '<html lang="ru" data-theme="heavy-light">',
      // Активный режим отражён в разметке, и это та же строка, которую увидит
      // клиент при гидрации: разойтись им нельзя.
      html: ['x-sp-test', 'xh-card', 'x-tokenized', 'data-active-mode>light<'],
      htmlAbsent: ['data-active-mode>dark<'],
    },
    dark: {
      mode: 'dark',
      rootTag: '<html lang="ru" data-theme="heavy-dark">',
      html: ['x-sp-test', 'xh-card', 'x-tokenized', 'data-active-mode>dark<'],
      htmlAbsent: ['data-active-mode>light<'],
    },
    cookie: {
      mode: 'dark',
      rootTag: '<html lang="ru" data-theme="heavy-dark">',
      html: ['data-active-mode>dark<'],
    },
    unknown: {
      mode: 'light',
      rootTag: '<html lang="ru" data-theme="heavy-light">',
      html: ['data-active-mode>light<'],
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
      { what: 'токен компонента для режима light', css: '--x-tokenized:red' },
      { what: 'токен компонента для dark — оба режима в CSS сразу', css: '--x-tokenized:yellow' },
      { what: 'пара тёмного режима, обещанная манифестом', css: '[data-theme=heavy-dark]' },
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
    // `XTokenized` кладёт токены и для темы `paper` другого каталога — здесь её нет (C-36).
    warnings: { 'token-undefined': 1, 'component-theme-unknown': 1 },
  },

  report: (report, check) => {
    check(
      report.selection.map(s => s.key.split(':').pop()).join(',') === 'XTest1,XgQuick,XhCard,XTokenized',
      `селекция: ${report.selection.map(s => s.key)}`,
    )
    check(report.themes.theme === 'heavy' && report.themes.modesSource === 'theme', `тема и режимы: ${report.themes.theme}, ${report.themes.modesSource}`)
    check(report.classes.unmatched.length === 0, `классы без правила: ${JSON.stringify(report.classes.unmatched)}`)
    // Обрезка включена и что-то сняла, но токен, до которого достаёт только
    // разметка приложения, остался: серверный рендер её не обманывает.
    check(report.prune?.mode === 'on', `режим обрезки: ${report.prune?.mode}`)
    check(report.prune.removable.length > 0, 'обрезка не сняла ни одного токена')
    check(!report.prune.removable.includes('--x-tokenized'), 'обрезка сняла токен, который держит разметка приложения')
  },
}
