# `@feugene/granum-engine-wind`

Движок утилит для [`@feugene/granum`](../granum): вендоренный форк ядра UnoCSS
66.7.5 с `preset-wind3`, упакованный в инстанс `GranumEngine`. Зависимостей нет
ни одной.

```ts
// granum.config.ts
import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

export default defineGranumConfig({
  providers: ['@acme/ui'],
  engine: windEngine(),
})
```

## Что объявляет движок

| Поле | Значение | Зачем |
|---|---|---|
| `dialect` | `unocss/preset-wind3+granum@66`, а при `extraRules: false` — `unocss/preset-wind3@66` | имя словаря: по нему granum решает, грузить ли модуль правил провайдера |
| `vocabulary` | отпечаток фактического набора правил и вариантов | по нему granum решает, верить ли списку классов манифеста или пересчитать его |
| `version` | версия вендоренного апстрима | только для чтения человеком, в решениях не участвует |

Правила приложения передаются фабрике, а не конфигу granum:

```ts
windEngine({ rules: [['icon-user', { background: 'url(/icons/user.svg)' }]] })
```

Такой движок объявляет тот же диалект и другой отпечаток — granum пересчитает
классы пакетов своим движком и покажет, что он нашёл сверх манифеста.

## Опции

| Опция | По умолчанию | Меняет диалект | Меняет отпечаток |
|---|---|---|---|
| `extraRules` | `true` | да | да |
| `rules`, `variants` | — | нет | да |
| `preflights` | — | нет | нет |
| `preflight` | `true` | нет | нет |
| `variablePrefix` | `--un-` | нет | нет |

### Единственное доп-правило

`extraRules` включает ровно одно правило: альфу на произвольном цвете. wind3
класс `bg-[var(--gr-bg)]/55` совпадает, но `/55` **молча теряет** — отдаёт
`background-color: var(--gr-bg)`. С правилом получается
`color-mix(in srgb, var(--gr-bg) 55%, transparent)`.

Поэтому `extraRules: false` — другой диалект, хотя множество имён то же: смысл
имени часть словаря наравне с его наличием.

Семейств доп-правил было восемь — перенос `unocss-mini-extra-rules` времён
`preset-mini`. С переходом на wind3 семь стали лишними: `sr-only`,
`animate-spin`, `tabular-nums` и восемь numeric-соседей, `object-*`, `space-*`,
`divide-*`, `uppercase`, `filter`, `hue-rotate-*`, `drop-shadow-color-*` —
у wind3 всё это родное.

## Preflight отдельным полем

Движок возвращает `{ css, preflight }`, а не одну строку: инициализация `--un-*`
на `*` и `::backdrop` — CSS базового уровня, и granum кладёт её в слой
`granum.base`, до стилей компонентов. Утилиты уезжают в `granum.utilities`. Какие
это слои, движок не знает и знать не должен — он сообщает только род CSS.

## Вендоринг

Апстрим копируется скриптом, а не правится руками:

```bash
yarn vendor:unocss    # перегенерировать src/vendor
yarn check:vendor     # сверить с зафиксированным
```

Лицензии апстрима — в [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
