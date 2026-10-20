# `app-theme-previews`

Превью отдельным листом: активна тема `paper` каталога
[`@granum-fixtures/themes`](../../fixtures/themes-package/README.md), рядом
показана `ink` (`previews: ['ink']`), а `css: { previews: 'separate' }` уводит её
блоки из общего листа в модуль `virtual:granum/previews.css`.

Страниц две, и разный CSS у них — главное, что проверяет стенд: склейка всех
ассетов этого не различит, поэтому `expected.mjs` судит по листам, которые
подключает каждая страница (`pages`).

| Что | Где видно |
|---|---|
| обычная страница превью не платит | `index.html`: только общий лист, блоков `[data-theme=ink-…]` в нём нет |
| страница дизайн-системы получает превью | `previews.html`: общий лист и лист превью — полный блок пары и формулы под списком её пар |
| лист превью не меняет каскад, даже подключённый раньше общего | порядок слоёв `@layer granum.tokens,granum.base;` перед `@layer granum.themes{…}` |
| превью никогда не выходит под `:root` | `:root,[data-theme=ink-` в CSS нет |

```bash
yarn workspace @granum-apps/app-theme-previews build
yarn workspace @granum-apps/app-theme-previews verify
```
