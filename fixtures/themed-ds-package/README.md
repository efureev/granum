# `fixtures/themed-ds-package`

Компоненты поверх чужих тем. Своего каталога нет: владелец тем —
`@granum-fixtures/themes`, строковая зависимость провайдера, и приложению
хватает этого пакета в `providers` — владельца granum подгружает сам (A-31).

| Компонент | Токены по темам |
|---|---|
| `TdButton` | `themes/paper/modes/{light,dark}.json`, `themes/ink/modes/light.json`; остальное у `ink` — по цепочкам `ink → paper` и `dim → dark` |
| `TdCard` | `themes/paper/root.json` — режимонезависимый токен |
| `TdBadge` | нет: хук `var(--td-badge-bg, var(--th-accent))` со значением по умолчанию |

```bash
yarn workspace @granum-fixtures/themed-ds build
yarn workspace @granum-fixtures/themed-ds verify
```
