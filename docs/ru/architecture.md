# Архитектура

> 🇬🇧 English version: [`../en/architecture.md`](../en/architecture.md).

Визуальная схема конвейера: https://claude.ai/artifact/41CJUc18uAaaCdm23xWezq
(исходник — [`../architecture-pipeline.html`](../architecture-pipeline.html)).
Нормативные требования — в [ТЗ](../spec.md), инварианты — в
[реестре](../invariants.md).

## Конвейер

```
СБОРКА ПРОВАЙДЕРА (один раз, при публикации)
  исходники ──► ./build ──► dist/components/<Name>/{index.js, chunks/, styles.css}
                            dist/theme/*.css
                            dist/granum.manifest.json          ← точка передачи

СБОРКА ПРИЛОЖЕНИЯ (vite build / dev)
  granum.config.ts ──► резолвер ──► Resolution ──► ./vite ──┬─► JS:     virtual:granum/components, guard
        ▲                                                   ├─► CSS:    ./engine + сборщик @layer → virtual:granum.css
  манифесты провайдеров (через exports пакета)              └─► токены: prune, манифест тем → virtual:granum/themes → ./runtime
```

Три принципа, из которых следует всё остальное:

- **один источник правды на этап** — дескрипторы у провайдера, манифест у
  пакета, `Resolution` у приложения;
- **считать один раз там, где данные родились** — классы и потребление
  токенов на сборке провайдера, селекция и слои токенов на сборке приложения;
- **молчаливых поломок нет** — расхождение либо ошибка типа, либо ошибка
  регистрации или сборки, либо строка отчёта.

## Точки входа

| Entry | Среда | Содержимое |
|---|---|---|
| `.` | browser + node | контракт и резолвер: `resolveGranum`, типы `GranumResolution`, ошибки |
| `./contract` | browser + node | `defineGranumProvider`, `defineGranumComponent`, `GRANUM_CONTRACT_VERSION` |
| `./engine` | browser + node | `createEngine`, интерфейс `GranumEngine`, типы правил |
| `./runtime` | browser | `createThemeController`, `resolveThemeActivation` |
| `./build` | node, peer `vite` | плагин `granumProvider()` |
| `./vite` | node, peer `vite` | плагин `granum()`, `defineGranumConfig` |
| `./node` | node | чтение манифестов, `prepareApp`, `emitCss`, `buildReport`, диагностика как функции |
| `./codegen` | node | генерация реестров, barrel, `exports` |
| `bin/granum` | node | CLI |

Браузерные entry не импортируют `node:*` и не имеют зависимостей; это
проверяет `yarn check:boundary` на `dist`. Node-entry недостижимы из
браузерного кода провайдера — сборка провайдера ловит нарушение
(`BoundaryViolationError`).

## Резолюция

`resolveGranum({ providers, components, themes })` — чистая функция: без FS,
сети и глобального состояния. Вход — манифесты (`{ manifest, baseUrl }`) или
объекты контракта; обе формы нормализуются в узлы провайдеров. Результат —
упорядоченный граф провайдеров, реестр компонентов, селекция после
транзитивного замыкания, активные темы с источником, слои токенов с
эффективными значениями, классы и safelist селекции, список CSS в порядке
эмиссии, предупреждения. За один билд существует ровно одна резолюция:
мемоизация по идентичности конфига.

## Движок утилит

Вендоренное ядро UnoCSS 66.7.5 (`@unocss/core`, `preset-mini`, `rule-utils`
без `magic-string`, `extractor-arbitrary-variants`) плюс перенесённые правила
`unocss-mini-extra-rules` — за структурным интерфейсом `GranumEngine`:

```ts
interface GranumEngine {
  name: string
  extract: (code: string, id: string) => ReadonlySet<string>
  generate: (input: EngineInput) => Promise<EngineOutput>   // { css, matched, unmatched }
}
```

Движок чист и детерминирован; каждый класс входа попадает либо в `matched`
(с правилом, источником и слоем), либо в `unmatched` — молча не отбрасывается
ничего. Код движка живёт на сборке и в клиентский бандл приложения не
попадает. Golden-тест сверяет вывод с живым `unocss@66.7.5`.

## CSS: каскадные слои

```css
@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;
```

Порядок объяснён именами, а не числами: `utilities` позже `components`,
поэтому утилита шаблона побеждает базовый стиль компонента; нелейерный CSS
приложения побеждает всё. CSS компонентов проходит побайтно (кроме
раскрытия `@apply`, выполненного провайдером, и обрезки токенов). Слои
доступны и по отдельности: `virtual:granum/layers/<name>.css`.

## Диагностика

Отчёт сборки и CLI вычисляются теми же функциями, что и эмиссия: отчёт не
может назвать значение, которого нет в сборке. Архитектурный тест следит,
что эффективное значение токена вычисляется в одном месте.
