# `app-theme-values-stale`

Тема отстала от пакета компонентов: написана под `valued-ds ^0.9.0`, а в сборке
1.0.0. Сборка печатает предупреждение `theme-target-mismatch`, `doctor` называет
каждое место: значения, которых в теме нет (`theme-incomplete`), хук в её разделе
(`theme-token-foreign`), значения компонента, которого в пакете нет
(`theme-component-unknown`). Версия пакета — грубый сигнал, полнота — точный:
нужны оба.

```bash
yarn workspace @granum-apps/app-theme-values-stale build
yarn workspace @granum-apps/app-theme-values-stale verify
```
