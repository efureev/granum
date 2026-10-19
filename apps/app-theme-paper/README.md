# `app-theme-paper`

Приложение выбирает тему каталога по имени: `theme: 'paper'`. Владельца тем,
[`@granum-fixtures/themes`](../../fixtures/themes-package/README.md), в
`providers` нет — его подгружает строковая зависимость
[`@granum-fixtures/themed-ds`](../../fixtures/themed-ds-package/README.md).

В CSS едут только данные `paper` и токены компонентов для неё: вторая тема
каталога, `ink`, не читается вовсе, а токены спутника
[`themed-companion`](../../fixtures/themed-companion-package/README.md), заведённые
только для `ink`, в сборку не попадают.

| Что | Где видно |
|---|---|
| режим по умолчанию под `:root` и своей парой, тёмный — парой | `:root,[data-theme=paper-light]` и `[data-theme=paper-dark]` в CSS |
| литерал `root` темы — в слое `tokens`, формула — под общей границей | `--th-radius:6px`; `:root,[data-theme]{--td-button-bg:var(--th-accent)` |
| токены кнопки для `paper/dark` из `themesDir` компонента | `--td-button-shadow:none` |
| вариант `dark:` строится по паре тёмного режима | `[data-theme=paper-dark] .dark\:underline` |
| данных и пар `ink` нет, классов `.dark` нет | `absent` в `expected.mjs` |
| источник темы — конфиг | `themes.themeSource: 'provider'` в отчёте |

```bash
yarn workspace @granum-apps/app-theme-paper build
yarn workspace @granum-apps/app-theme-paper verify
```

`doctor` отдаёт одно ожидаемое предупреждение `component-theme-unknown`: у
спутника есть папка `themes/unknown/` — тема, которой нет ни в одном каталоге.
