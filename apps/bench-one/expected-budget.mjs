/**
 * Ожидаемый бюджет bench-one. Проверяется `node scripts/report-css-budget.mjs --strict`
 * из каталога стенда (`yarn sizes:check`). Сверка идёт в обе стороны: пропавшее
 * ожидаемое нарушение — такое же расхождение, как появившееся новое.
 */
export default {
  purpose: 'бюджет CSS/JS одного компонента поверх полного фундамента',
  assets: { roles: ['vue', 'pkg', 'css', 'entry'] },
  granum: {
    // Намеренная фикстура heavy: у `shadow-legacy` правила нет (INV-DIAG-2).
    unmatched: ['shadow-legacy'],
    undefinedTokens: [],
    pruneMode: 'off',
    // Движок утилит — build-time; в клиентский бандл он не попадает (N-5).
    noEngineInBundle: true,
  },
  // Ориентиры, НЕ гейт: печатаются рядом с фактом (gzip).
  hints: { cssGzip: 2000, componentCostGzip: 4300 },
}
