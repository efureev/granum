/**
 * Допустимые расхождения множеств CSS-правил bench-one на granum и на пресете
 * v1 (`v1-snapshot.css`). Проверяется `node scripts/compare-css.mjs`.
 *
 * Список был пуст, пока движок вендорил preset-mini с теми же доп-правилами, что
 * у пресета v1. С переходом на preset-wind3 появились два расхождения, и оба
 * ожидаемы. Всё, что сверх них, гейт по-прежнему валит: фундамент, CSS
 * компонентов и утилиты шаблонов обязаны совпадать байт в байт.
 */
export default {
  /**
   * `animationPreflights` пресета v1 эмитировали `@keyframes granularity-spin`
   * **всегда** — даже когда `animate-spin` в сборке не встречался; на bench-one
   * это ровно тот случай. wind3 рождает keyframes правилом, то есть по факту
   * употребления класса, поэтому у granum мёртвого блока больше нет.
   */
  onlyV1: [
    '|@keyframes granularity-spin',
    // Тема — данные, режим включается парой (ADR-11): классов `.dark` и атрибута
    // `[data-theme=dark]` пресета v1 больше нет — ни в блоках, ни в фолбэках.
    '|.dark',
    '|[data-theme=dark]',
    '@supports not (color:color-mix(in oklab,red,blue))|.dark',
    '@supports not (color:color-mix(in oklab,red,blue))|[data-theme=dark]',
    // Фолбэк светлого режима v1 стоял под `:root` и на корне с тёмной парой
    // перебивал её позицией; у granum он под корнем без атрибута и своей парой.
    '@supports not (color:color-mix(in oklab,red,blue))|:root',
  ],
  /**
   * Их место заняли блоки пар `heavy-light`/`heavy-dark` и общий блок формул
   * под `[data-theme]`: формула, одинаковая во всех режимах, пересчитывается на
   * каждом острове, а не наследуется готовой от корня (T-8…T-10).
   */
  onlyGranum: [
    '|[data-theme]',
    '|[data-theme=heavy-light]',
    '|[data-theme=heavy-dark]',
    '@supports not (color:color-mix(in oklab,red,blue))|[data-theme=heavy-light]',
    '@supports not (color:color-mix(in oklab,red,blue))|[data-theme=heavy-dark]',
    '@supports not (color:color-mix(in oklab,red,blue))|:root:not([data-theme])',
  ],
  /**
   * Preflight инициализирует кастомные свойства, которыми пользуются утилиты.
   * Словарь wind3 шире preset-mini (фильтры, backdrop-фильтры, `touch-action`,
   * `border-spacing`, scroll-snap), поэтому и объявлений в нём больше. Значения
   * общих переменных совпадают — расходится только состав.
   */
  changed: [
    '|*',
    '|:before',
    '|:after',
    '|::backdrop',
    // `:root` светлого режима: формулы ушли под общую границу, `color-scheme` — в блок режима.
    '|:root',
  ],
}
