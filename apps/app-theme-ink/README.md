# `app-theme-ink`

Тема `ink` — наследница `paper` в каталоге
[`@granum-fixtures/themes`](../../fixtures/themes-package/README.md): задаёт только
отличия и добавляет режим `dim`, наследующий `dark`. Рядом показана `paper` —
превью (`previews: ['paper']`).

Токены компонентов, которых у `ink` нет, берутся по двум цепочкам: режимов
(`dim → dark → light`) снаружи и тем (`ink → paper`) внутри. Превью едет полными
блоками своих пар и никогда не выходит под `:root`.

| Что | Где видно |
|---|---|
| три режима темы, `dim` своей парой | `:root,[data-theme=ink-light]`, `[data-theme=ink-dim]` в CSS |
| свой литерал `root` темы | `--th-radius:2px` |
| свой токен кнопки для `ink/light` | `--td-button-shadow:0 0 0 1px var(--th-fg)` |
| токены спутника, заведённые только для `ink`, на месте | `--tc-chart-grid:#374151` |
| превью `paper`: формулы под префиксом её пар, полные блоки пар | `[data-theme^=paper-]{`, `[data-theme=paper-light]{…--td-card-pad:12px` |
| вариант `dark:` — по парам обоих тёмных режимов | `[data-theme=ink-dim] .dark\:underline` |

```bash
yarn workspace @granum-apps/app-theme-ink build
yarn workspace @granum-apps/app-theme-ink verify
```

Пары превью переключает тот же атрибут: `data-theme="paper-dark"` на любом
элементе показывает его поддерево в `paper`, не трогая остальную страницу.
