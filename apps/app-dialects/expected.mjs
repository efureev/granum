/**
 * Ветка «другой диалект, наборы разошлись» (таблица §8 ТЗ движка, AC-E1).
 *
 * Пакет собран движком с доп-правилами, приложение — без них. Это разные
 * словари, и granum обязан не поверить списку классов манифеста, а пересчитать
 * его. `divide-y` пересчёт не находит: правила для него у движка приложения нет.
 * Главное здесь — что класс не исчезает молча: он назван в `lost`, подан
 * движку и виден в `unmatched` (A-E7, INV-DIAG-2, INV-ENG-11).
 */
export default {
  purpose: 'другой диалект: классы пакета пересчитаны, потерянный класс назван, а не потерян молча',
  doctor: {
    warnings: { 'provider-dialect-mismatch': 1, 'provider-classes-dropped': 1 },
  },
  css: {
    present: [
      { what: 'слои каскада на месте', css: '@layer granum.utilities{' },
      { what: 'фундамент пакета доехал', css: '--xh-space-3:12px' },
      // `px-[var(--xh-space-3)]` пережил пересчёт: это общая часть словарей.
      { what: 'классы общей части словаря пересчитаны и сгенерированы', css: 'var(--xh-space-3)' },
      { what: 'утилита приложения из App.vue', css: 'padding:1.5rem' },
    ],
    absent: [
      // `divide-y` — из доп-правил, которых у движка приложения нет. Правило
      // не выдумывается: его в CSS быть не должно.
      { what: 'правила чужого словаря не выдуманы', css: 'divide-y-reverse' },
    ],
  },
  report: (report, check) => {
    check(report.engine.dialect === 'unocss/preset-mini@66', `движок приложения: ${report.engine.dialect}`)
    const provider = report.providers.find(p => p.id === '@granum-fixtures/heavy')
    check(provider?.dialect === 'unocss/preset-mini+granum@66', `диалект пакета: ${provider?.dialect}`)
    check(provider?.reason === 'dialect', `причина пересчёта: ${provider?.reason}`)
    check(provider?.classes === 're-extracted', `источник классов: ${provider?.classes}`)
    check(provider?.lost.join(',') === 'divide-y', `lost: ${provider?.lost}`)
    check(provider?.gained.length === 0, `gained: ${provider?.gained}`)
    // Потерянный класс остался громким: он в `unmatched` и с названным источником.
    const unmatched = report.classes.unmatched.find(e => e.className === 'divide-y')
    check(unmatched?.sources.join(',') === '@granum-fixtures/heavy', `unmatched divide-y: ${JSON.stringify(unmatched)}`)
  },
}
