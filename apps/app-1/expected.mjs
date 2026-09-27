/** Что app-1 обязан эмитить. Проверяется `node scripts/verify-app.mjs`. */
export default {
  purpose: 'один компонент из манифеста: слои, CSS компонента, утилиты шаблона и приложения',
  doctor: {
    // `--brd` компоненту даёт приложение: фикстура объявляет только границу
    // как форму, а цвет — дело потребителя (так делает app-2 через
    // `themes.tokenOverrides`). Здесь его нет, и доктор честно об этом говорит.
    warnings: { 'token-undefined': 1 },
  },
  css: {
    present: [
      { what: 'слои каскада на месте: пустые объявлены, непустые — блоками (INV-CSS-1)', css: '@layer granum.tokens;@layer granum.base{' },
      { what: 'слой тем пуст и объявлен между base и components', css: '@layer granum.themes;@layer granum.components{' },
      // У провайдера app-1 нет ни tokens.css, ни base.css: всё содержимое слоя
      // `base` — preflight движка. Он обязан быть до CSS компонентов, иначе
      // утилиты, читающие `--un-*`, получают невалидные значения (INV-CSS-8).
      { what: 'preflight движка в слое base, а не в утилитах (E-15, INV-CSS-8)', css: '@layer granum.base{*,:before,:after,::backdrop{--un-rotate:0' },
      { what: 'утилиты — отдельным слоем после компонентов', css: '@layer granum.utilities{' },
      { what: 'CSS компонента XTest1 из его SFC <style>', css: '.x-sp-test' },
      { what: '@apply раскрыт на сборке провайдера (B-11)', css: 'font-weight:700' },
      { what: 'утилита p-4 из шаблона XTest1 — класс из манифеста', css: 'padding:1rem' },
      { what: 'арбитражное значение из шаблона XTest1', css: 'var(--brd)' },
      { what: 'утилита приложения из App.vue', css: 'max-width:48rem' },
    ],
    absent: [
      { what: 'safelist невыбранного XTestStyled', css: '--card-fg' },
      { what: 'классы невыбранного XNestedReverse', css: 'rounded-3xl' },
      { what: 'директив @apply в выводе нет', css: '@apply' },
    ],
  },
  report: (report, check) => {
    check(report.selection.map(s => s.key).join(',') === '@granum-fixtures/simple:XTest1', `selection: ${report.selection.map(s => s.key)}`)
    check(report.classes.unmatched.length === 0, `unmatched: ${JSON.stringify(report.classes.unmatched)}`)
  },
}
