/**
 * Дополнительные правила поверх preset-wind3 (E-4).
 *
 * Их было восемь семейств — перенос `@feugene/unocss-mini-extra-rules` 0.8.1,
 * который затыкал дыры preset-mini. С переходом на preset-wind3 семь из восьми
 * стали лишними: `sr-only`, `animate-spin`, `tabular-nums` и восемь numeric-соседей,
 * `object-*`, `space-*`, `divide-*`, `uppercase`, `filter`, `hue-rotate-*`,
 * `drop-shadow-color-*` — всё это у wind3 родное.
 *
 * Осталось одно, и по делу: wind3 не умеет применять альфу к произвольному цвету
 * в скобках. `bg-[var(--gr-bg)]/55` он отдаёт как `background-color:var(--gr-bg)`,
 * **молча теряя альфу** — класс совпал, CSS неверный, ошибки нет. Правило ниже
 * возвращает `color-mix`, и стоит оно после правил пресета, поэтому побеждает
 * (INV-ENG-3).
 */
export * from './colorOpacity'
