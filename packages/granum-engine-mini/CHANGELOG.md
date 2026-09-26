# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версии — [semver](https://semver.org/lang/ru/).

## 0.2.0

Первый выпуск. Движок выделен из `@feugene/granum`, где лежал как `'builtin'`.

### Добавлено

- `miniEngine(options)` — инстанс `GranumEngine` на вендоренном форке UnoCSS
  66.7.5 (`preset-mini` плюс дополнительный набор правил).
- Диалект словаря: `unocss/preset-mini+granum@66`, либо
  `unocss/preset-mini@66` при `extraRules: false`.
- Отпечаток словаря по фактическому набору правил и вариантов, включая
  переданные через `options.rules` и `options.variants`.
- Правила, варианты и preflights приложения — опциями фабрики.
