/**
 * Стенд «правила в пакете»: свои правила приложение не передаёт фабрике движка, а
 * берёт из провайдера без компонентов. Движок ванильный, отпечаток словаря
 * совпадает с манифестом пакета — правила загружены, а классы пакетов не
 * пересчитываются. Ради этого быстрого пути пакет и вынесен.
 */
export default {
  purpose: 'правила в пакете: провайдер без компонентов, движок приложения ванильный, пересчёта нет',
  doctor: { warnings: {} },
  css: {
    present: [
      { what: 'статическое правило пакета brand-logo', css: '.brand-logo{color:#fff;background-color:#7c3aed;border-radius:9999px' },
      { what: 'регэксп-правило пакета brand-pad-3', css: '.brand-pad-3{padding:12px' },
      { what: 'обычная утилита словаря wind', css: '.p-6{padding:1.5rem' },
    ],
    absent: [],
  },
  report: (report, check) => {
    const pkg = report.providers.find(p => p.id === '@granum-fixtures/rules-only')
    check(pkg?.rulesLoaded === true, `правила пакета загружены: ${pkg?.rulesLoaded}`)
    // Быстрый путь: отпечатки совпали, список классов манифеста принят как есть.
    check(pkg?.vocabulary === report.engine.vocabulary, `отпечаток пакета ${pkg?.vocabulary} и движка ${report.engine.vocabulary}`)
    check(pkg?.classes === 'manifest' && pkg?.reason === 'none', `быстрый путь: ${pkg?.classes}/${pkg?.reason}`)
    check(report.selection.length === 0, `компонентов в селекции нет: ${JSON.stringify(report.selection)}`)
    check(report.classes.unmatched.length === 0, `unmatched: ${JSON.stringify(report.classes.unmatched)}`)
  },
}
