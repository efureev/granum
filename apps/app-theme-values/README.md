# `app-theme-values`

Значения компонентов у темы (ADR-13): пакет компонентов объявляет имена токенов,
темы дают значения. Темы одной сборки приходят из трёх мест.

| Тема | Откуда | Как устроена |
|---|---|---|
| `stone` | `@granum-fixtures/valued-ds` | базовая тема пакета, основная тема сборки |
| `moss` | `@granum-fixtures/valued-ds` | копия `stone` (`granum theme copy`) с правками |
| `ember` | `@granum-fixtures/valued-ds` | наследник `stone` |
| `tide` | `@granum-fixtures/theme-tide` | тема-объект отдельного пакета: наследует `stone` живьём, `targets` — `valued-ds ^1.0.0` |
| `reef` | `src/themes/reef/` | своя тема приложения: исходник поверх `moss` |

`doctor` чистый: каждая тема полна, значения разделов — требования компонентов,
версии пакетов в диапазонах `targets`.

```bash
yarn workspace @granum-apps/app-theme-values build
yarn workspace @granum-apps/app-theme-values verify
```
