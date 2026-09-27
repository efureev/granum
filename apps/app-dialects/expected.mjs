/**
 * Ветка «другой диалект» (таблица §8 ТЗ движка, AC-E1).
 *
 * Пакет собран движком словаря `granum-fixtures/atoms@1` и привозит правила для
 * него модулем. Приложение говорит на `unocss/preset-wind3+granum@66`. Из этого
 * следуют три обязательства granum, и все три проверяются здесь:
 *
 *   1. правила пакета не загружаются (`engine-rules-skipped`);
 *   2. списку классов манифеста не верят — он пересчитывается;
 *   3. имена, которых словарь приложения не знает, названы поимённо в `lost`,
 *      поданы движку и видны в `unmatched` (A-E7, INV-DIAG-2, INV-ENG-11).
 *
 * Обратная сторона — `app-atoms`: там движок и пакет говорят на одном словаре.
 */
export default {
  purpose: 'другой диалект: правила пакета не грузятся, классы пересчитаны, потерянные названы, а не потеряны молча',
  doctor: {
    warnings: {
      'provider-dialect-mismatch': 1,
      'engine-rules-skipped': 1,
      'provider-classes-dropped': 1,
    },
  },
  css: {
    present: [
      { what: 'слои каскада на месте', css: '@layer granum.utilities{' },
      // Фундамент от словаря не зависит: это CSS-файлы пакета, а не утилиты.
      { what: 'токены пакета доехали, несмотря на расхождение словарей', css: '--at-bg:#fff' },
      { what: 'тема пакета доехала', css: '--at-radius:6px' },
      { what: 'preflight движка приложения — в слое base (E-15, INV-CSS-8)', css: '@layer granum.base{*,:before,:after,::backdrop{--un-rotate:0' },
      { what: 'утилита приложения из App.vue — на своём словаре она работает', css: 'padding:1.5rem' },
    ],
    absent: [
      // Правила пакета не загружены, а выдумывать granum не умеет: ни одного
      // `atom-*` в CSS быть не должно.
      { what: 'правила чужого словаря не выдуманы', css: 'atom-stack' },
      { what: 'и произвольное значение чужого словаря тоже', css: 'atom-bg-' },
    ],
  },
  report: (report, check) => {
    check(report.engine.dialect === 'unocss/preset-wind3+granum@66', `движок приложения: ${report.engine.dialect}`)
    const provider = report.providers.find(p => p.id === '@granum-fixtures/atoms')
    check(provider?.dialect === 'granum-fixtures/atoms@1', `диалект пакета: ${provider?.dialect}`)
    check(provider?.reason === 'dialect', `причина пересчёта: ${provider?.reason}`)
    check(provider?.classes === 're-extracted', `источник классов: ${provider?.classes}`)
    check(provider?.gained.length === 0, `gained: ${provider?.gained}`)
    // Пересчёт идёт по пакету целиком, поэтому в `lost` и классы компонента, в
    // селекцию не попавшего (`AtChip`). Важно не число, а что ни одно имя не
    // пропало без упоминания.
    check(
      provider?.lost.join(',') === 'atom-bg-[var(--at-bg)],atom-frame,atom-gap-2,atom-inline,atom-pad-1,atom-round,atom-stack',
      `lost: ${provider?.lost}`,
    )
    for (const className of provider?.lost ?? []) {
      const entry = report.classes.unmatched.find(e => e.className === className)
      check(entry?.sources.join(',') === '@granum-fixtures/atoms', `unmatched ${className}: ${JSON.stringify(entry)}`)
    }
  },
}
