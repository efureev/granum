# `fixtures/mini-ds-package`

Миниатюрная дизайн-система на контракте granum: две темы, базовые токены,
глобальный слой и **два** компонента. Пакет намеренно маленький и намеренно
избыточный: его объявления шире того, что берёт любое приложение, и на этом
разрыве стоит стенд [`apps/dist-audit`](../../apps/dist-audit/README.md).

## Состав

```
src/
  styles/tokens.css          --xxx-space-1, --xxx-space-2, --xxx-radius, --xxx-font-sm
  styles/base.css            сброс и типографика; объявлений токенов нет
  styles/themes/light.css    :root — тема по умолчанию
  styles/themes/dark.css     .dark, [data-theme="dark"]
  components/XxCard/         две утилиты + собственный styles.css
  components/XxBadge/        четыре утилиты, своего CSS нет
```

Префикс токенов — `--xxx-*`. В раскладке `dist` пути темы лежат зеркально
(`styles/tokens.css`), копирует их плагин сборки.

## Мёртвый груз — часть фикстуры

| Токен | Кто берёт |
|---|---|
| `--xxx-bg`, `--xxx-fg` | `base.css` и `XxCard` — переживают обрезку всегда |
| `--xxx-line`, `--xxx-radius`, `--xxx-space-2` | только `XxCard` |
| `--xxx-accent`, `--xxx-accent-fg`, `--xxx-space-1` | только `XxBadge` |
| `--xxx-font-sm`, `--xxx-muted` | никто |

Приложение, взявшее один компонент, обязано увезти пять токенов из десяти —
это и проверяет стенд аудита.

Классов у компонентов шесть на двоих: аудит считает их поимённо, и любой
лишний виден сразу.

## Команды

```bash
yarn workspace @granum-fixtures/mini-ds build
yarn workspace @granum-fixtures/mini-ds verify
```

`verify` проверяет round-trip манифеста (классы и потребляемые токены
пересчитываются по `dist` и сверяются с записанным) и актуальность реестров
(`granum codegen --check`).
