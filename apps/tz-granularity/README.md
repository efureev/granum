# tz-granularity

Стенд воспроизведения ТЗ от granularity —
[`docs/tz-granularity-2026-10-15/README.md`](../../docs/tz-granularity-2026-10-15/README.md).
Пакетов granularity не нужно: провайдер — фикстура
[`@granum-fixtures/composite`](../../fixtures/composite-package) с составным компонентом
`XcList` и его частью `XcListItem`.

```bash
yarn build                                          # granum и движок
yarn workspace @granum-fixtures/composite build
yarn workspace @granum-apps/tz-granularity repro    # по каждому пункту: что сейчас и что ждём
yarn workspace @granum-apps/tz-granularity repro:expect   # код 1, пока хоть один пункт воспроизводится
```

| Случай | Каталог | Что собирается |
|---|---|---|
| ТЗ-1, ТЗ-1б | `cases/guard` | импорт `components/XcListItem` при селекции `[XcButton]` и при `components: 'imports'` |
| ТЗ-2 | — | `granumResolver` по корню стенда |
| ТЗ-3 | `cases/regex` | модуль с регэкспом `/class="…/` и без единого класса разметки |
| ТЗ-4 | `cases/environments` | builder Vite с окружениями `server` (без CSS) → `client` |
| ТЗ-5 | `cases/raw-css` | лист приложения, подключённый строкой через `?raw` |

`build` и `verify` у стенда нет намеренно: `build:apps` и `verify:apps` его пропускают,
и CI не краснеет, пока пункты открыты. Когда `repro:expect` зелёный, он становится
`verify` стенда, и случаи переезжают в обычные проверки.
