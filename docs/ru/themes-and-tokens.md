# Темы и токены

> 🇬🇧 English version: [`../en/themes-and-tokens.md`](../en/themes-and-tokens.md).

Токен — CSS custom property (`--xh-accent`). Провайдер объявляет токены
файлами (`tokensCss`, файлы тем) и структурно (`tokenDefinitions`);
приложение выбирает активные темы, добавляет свои и переопределяет значения.
Все имена в конфигах и дескрипторах пишутся **без** `--`: префикс добавляет
генератор, а ключ с `--` — ошибка регистрации `InvalidTokenKeyError`.

## Активный набор тем

Определяется в фиксированном порядке; источник виден в отчёте как
`namesSource`:

1. `themes.names` приложения (включая пустой список — тем нет);
2. ключи `themes.define` приложения;
3. объединение `defaultThemes` всех провайдеров графа;
4. `['light']`.

Файлы тем провайдера (`theme.themes[name]`) подключаются только для
активных имён; сломанная ссылка неактивной темы сборку не валит.

## Слои значений

Значение токена под селектором темы собирается из слоёв, каждый следующий
перекрывает предыдущий:

1. `theme.tokenDefinitions` провайдера;
2. `tokenDefinitions` компонентов — в порядке селекции;
3. `themes.define[name].tokens` приложения;
4. `themes.tokenOverrides[name]`.

Структурное определение темы побеждает CSS-файл той же темы: файл в этом
случае не читается. При `strictTokens: true` override токена, который не
объявлен ни одним пакетным слоем, отбрасывается — в отчёт попадает
`override-skipped`. Одна и та же функция считает значение для CSS, отчёта и
CLI: `granum tokens <id:Name> --deep` показывает цепочку слоёв целиком.

## Темы приложения

```ts
themes: {
  define: {
    emerald: { extends: 'light', tokens: { 'app-bg': '#052e1f' }, label: 'Изумруд', colorScheme: 'dark' },
    crimson: { extends: 'light', tokensRef: new URL('./src/themes/crimson.css', import.meta.url).href },
  },
}
```

`extends` наследует значения провайдерской темы (только структурные: тема из
файла непрозрачна, и отчёт скажет `theme-extends-unresolved`). `tokensRef` —
CSS-файл приложения, из которого токены материализуются на сборке. `label`
и `colorScheme` уходят в манифест тем для рантайма.

## Токены компонента

```ts
defineGranumComponent(import.meta.url, {
  name: 'XhCard',
  tokenDefinitions: { light: { selector: ':root', tokens: { 'xh-card-bg': 'var(--xh-surface)' } } },
  tokenDefinitionsRef: { dark: { url: './tokens.dark.css', selector: '.dark' } },
  dynamicTokens: ['xh-z-*'],
})
```

`tokenDefinitionsRef` читается на сборке провайдера и материализуется в
манифест: приложению файл не нужен. `strict` по умолчанию: нет селектора или
вложенность — `TokenParseError`, а не пустая тема.

## Потребление и отчёт

Сборка провайдера записывает в манифест, какие токены компонент
**потребляет**: `var(--x)` в CSS и JS, литералы `'--x'` в JS, `dynamicTokens`.
Приложение объединяет это с потреблением в `appSources`. Токен, который
потребляется и не объявлен ни одним слоем ни для одной активной темы, —
`token-undefined` в отчёте и `doctor`.

## Обрезка токенов

```ts
pruneTokens: { mode: 'on', keep: ['xh-brand-*'] }
```

Обрезка удаляет из слоёв `tokens` и `themes` объявления, недостижимые от
корней; `base` не трогается. Корни: потребление в CSS компонентов селекции,
`consumes` и `dynamic` из манифестов, `appSources`, `tokenOverrides`,
структурные слои, `keep`. Достижимость идёт по графу «токен → токены в его
значении», поэтому `--soft: color-mix(…, var(--danger))` держит `--danger`.

Порядок внедрения: `mode: 'report'` → посмотреть план в отчёте или
`granum prune` → `mode: 'on'`. Режим `off` не меняет эмиссию ни на байт.
Стенд [`bench-pruned`](./measuring-weight.md) показывает эффект: 117 → 49
объявленных токенов.

## Рантайм

```ts
import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'

const themes = createThemeController(manifest, { initial: 'auto', storageKey: 'theme' })
themes.list()      // ['light', 'dark', 'emerald']
themes.set('dark') // data-theme / класс / ничего — по манифесту
```

Манифест тем выводится из селекторов блоков: `[data-theme=dark]` → атрибут,
`.dark` → класс, `:root` → ничего. Для файла темы с необычным селектором
активацию можно задать явно через `granum(config, { themeManifest: { activations } })`.
