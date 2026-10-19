# `app-theme-own`

Своя тема приложения поверх `paper`: тема-объект в `theme`. Данные лежат в
`src/theme/` — `theme.json` (id `brand`, название, `extends: 'paper'`),
`root.json` и `modes/<режим>.json` только с отличиями. Маленькая функция стенда
`loadTheme.ts` дополняет их данными `paper` до полных: granum принимает тему
приложения только полной, а `extends` оставляет ему для цепочки токенов
компонентов.

| Что | Где видно |
|---|---|
| режим по умолчанию темы приложения | `:root,[data-theme=brand-light]` в CSS |
| свой токен кнопки в данных режима перекрыл токен компонента: тема-объект — слой после компонентов | `--td-button-shadow:0 0 0 2px #7c3aed` |
| там, где тема токен не задала, — токен компонента `paper` по `extends` | `--td-button-shadow:none` в тёмном режиме |
| режим приложения `modes.define.sepia` своей парой | `[data-theme=brand-sepia]{`, `--th-bg:#f4ecd8` |
| override корня (`modes.tokenOverrides.root`) — в слое `tokens` | `--th-font:Inter, sans-serif` |
| пар темы каталога нет | `absent: 'paper-'` |
| источник темы — приложение | `themes.themeSource: 'app'` в отчёте |

```bash
yarn workspace @granum-apps/app-theme-own build
yarn workspace @granum-apps/app-theme-own verify
```

Тема читается при загрузке конфига, поэтому её файлы перечислены в `sources`:
правка `src/theme/**` в dev перезапускает сервер.
