# `app-theme-sheets`

Две темы сборки каталога [`@granum-fixtures/themed-ds`](../../fixtures/themed-ds-package/README.md):
основная `paper` — в общем листе и под `:root`, дополнительная `ink` — своим листом.
Страница дизайн-системы импортирует его модулем `virtual:granum/themes/ink.css`, а
манифест `virtual:granum/themes` несёт адрес ассета листа — им пользуется
`loadThemeSheet` при переключении темы в рантайме.

Страниц две, и разный CSS у них — главное, что проверяет стенд: склейка всех
ассетов этого не различит, поэтому `expected.mjs` судит по листам, которые
подключает каждая страница (`pages`).

| Что | Где видно |
|---|---|
| обычная страница за дополнительную тему не платит | `index.html`: только общий лист, блоков `[data-theme=ink-…]` в нём нет |
| страница дизайн-системы получает лист | `previews.html`: общий лист и лист `ink` — полный блок пары и формулы под списком её пар |
| лист не меняет каскад, даже подключённый раньше общего | порядок слоёв перед `@layer granum.themes{…}`; `:root` основной темы — под `:where()` |
| дополнительная тема никогда не выходит под `:root` | `:root,[data-theme=ink-` в CSS нет |
| адрес листа — в манифесте, у основной темы его нет | JS: `granum-theme-ink-…`, но не `granum-theme-paper-…` |

```bash
yarn workspace @granum-apps/app-theme-sheets build
yarn workspace @granum-apps/app-theme-sheets verify
```
