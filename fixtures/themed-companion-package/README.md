# `fixtures/themed-companion-package`

Спутник дизайн-системы: своего каталога нет, зависит от
`@granum-fixtures/themed-ds`. У `TcChart` токены только для темы `ink` — при
активной `paper` их в CSS нет (C-35), и сетка берёт запасное значение `var()` —
поэтому `tc-chart-grid` объявлен в `hookTokens` (C-39). Подпись
`--tc-chart-label` читается так же, но хуком не объявлена — намеренно: стенды
`app-theme-*` видят на ней находку `token-fallback-only`. Папка `themes/unknown/` — тема, которой
нет ни в одном каталоге: приложение говорит о ней предупреждением
`component-theme-unknown` (C-36).
