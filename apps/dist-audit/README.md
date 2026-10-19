# `apps/dist-audit`

Стенд аудита дистрибутива: приложение из одного `div` и одного компонента,
собранное поверх миниатюрной дизайн-системы
[`@granum-fixtures/mini-ds`](../../fixtures/mini-ds-package/README.md).

## Зачем

Ответить на вопрос «что из пакета осталось в собранном приложении» так, чтобы
ответ можно было проверить глазами и гейтом. Пакет объявляет два компонента,
тему с двумя режимами и десять токенов; приложение берёт **один** компонент и
**один** режим. Всё остальное обязано исчезнуть:

| Что | Чем вырезается | Как видно |
|---|---|---|
| код `XxBadge` | его никто не импортирует | его классов нет в JS |
| классы и CSS `XxBadge` | селекция granum | их нет в CSS: в слои попадает только выбранное |
| токены только бейджа (`--xxx-accent`, `--xxx-accent-fg`, `--xxx-space-1`) | `pruneTokens: 'on'` | нет в слое тем |
| мёртвый груз шкалы (`--xxx-font-sm`, `--xxx-muted`) | `pruneTokens: 'on'` | нет ни в одном блоке |
| тёмный режим целиком | `modes: { names: ['light'] }` | в CSS нет ни пары `[data-theme=mini-dark]`, ни её значений |

Компонент импортируется из своего подпути `@granum-fixtures/mini-ds/components/XxCard`:
импорт компонента из корня пакета guard granum отвергает, потому что корень тянет
весь пакет, а селекция видит компонент только по подпути.

## Команды

```bash
yarn workspace @granum-apps/dist-audit build
yarn workspace @granum-apps/dist-audit audit:dist
yarn workspace @granum-apps/dist-audit verify
```

`audit:dist` читает `granum.manifest.json` пакета, собранный CSS и JS и
печатает отчёт: какие компоненты доехали, сколько токенов пакета в
дистрибутиве, сколько вырезано, есть ли недостижимые. Код выхода `1` — если
нашлось лишнее.

## Что печатает аудит

```
Components (js — information: the chunk layout is the bundler's call, granum does not touch JS):
  @granum-fixtures/mini-ds:XxBadge  NOT selected  js: 0/4  css: 0/4  own css: 0/0
  @granum-fixtures/mini-ds:XxCard   selected      js: 2/2  css: 2/2  own css: 1/1

Package tokens:
  declared by packages:  10
  in the dist:           5
  cut by pruning:        5
  unreachable in dist:   0
  declared elsewhere:    2 (application CSS)
```

Отдельной строкой идёт preflight движка (`--un-*`, 50 переменных): к пакету и
его обрезке он отношения не имеет, это фиксированная цена preset-mini. Снять
её можно `engine: { preflight: false }`, но тогда перестанут работать утилиты,
которые на эти переменные ссылаются.

## Слои CSS (raw / gzip, из `granum-report.json`)

```
tokens         64     80
base         1190    442
themes        172    144
components    114    109
utilities     235    167
всего        1775    693
```

Больше половины веса — preflight движка внутри слоя `base` (1039 байт). Сама
дизайн-система после обрезки занимает в дистрибутиве 501 байт: пять токенов,
свой базовый слой, светлый режим и CSS одного компонента. Включение второго
режима добавляет к слою `themes` 145 байт — разницу видно, если поменять
`modes.names` в `granum.config.ts`.
