/**
 * Допустимые расхождения множеств CSS-правил bench-one на granum и на пресете
 * v1 (`v1-snapshot.css`). Проверяется `node scripts/compare-css.mjs` (AC-2).
 * Пусто: тот же фундамент, те же компоненты, тот же движок 66.7.5 с теми же
 * доп-правилами — множества обязаны совпасть.
 */
export default {
  onlyV1: [],
  onlyGranum: [],
  changed: [],
}
