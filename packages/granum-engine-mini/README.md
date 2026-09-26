# `@feugene/granum-engine-mini`

Движок утилит для [`@feugene/granum`](../granum): вендоренный форк ядра UnoCSS
66.7.5 с `preset-mini` и дополнительным набором правил, упакованный в инстанс
`GranumEngine`.

```ts
// granum.config.ts
import { defineGranumConfig } from '@feugene/granum/vite'
import { miniEngine } from '@feugene/granum-engine-mini'

export default defineGranumConfig({
  providers: ['@acme/ui'],
  engine: miniEngine(),
})
```

## Что объявляет движок

| Поле | Значение | Зачем |
|---|---|---|
| `dialect` | `unocss/preset-mini+granum@66`, а при `extraRules: false` — `unocss/preset-mini@66` | имя словаря: по нему granum решает, грузить ли модуль правил провайдера |
| `vocabulary` | отпечаток фактического набора правил и вариантов | по нему granum решает, верить ли списку классов манифеста или пересчитать его |
| `version` | версия вендоренного апстрима | только для чтения человеком, в решениях не участвует |

Правила приложения передаются фабрике, а не конфигу granum:

```ts
miniEngine({ rules: [['icon-user', { background: 'url(/icons/user.svg)' }]] })
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

## Вендоринг

Апстрим копируется скриптом, а не правится руками:

```bash
yarn vendor:unocss    # перегенерировать src/vendor
yarn check:vendor     # сверить с зафиксированным
```

Лицензии апстрима — в [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
