# Архитектура

> 🇬🇧 English version: [`../en/architecture.md`](../en/architecture.md).

Визуальная схема конвейера — [`../architecture-pipeline.html`](../architecture-pipeline.html)
(откройте файл в браузере).
Нормативные требования — в [ТЗ](../spec.md), инварианты — в
[реестре](../invariants.md).

## Конвейер

```
СБОРКА ПРОВАЙДЕРА (один раз, при публикации)
  исходники ──► ./build + движок ──► dist/components/<Name>/{index.js, chunks/, styles.css}
                                     dist/theme/*.css
                                     dist/granum.manifest.json          ← точка передачи
                                     (в манифесте — диалект и отпечаток движка сборки)

СБОРКА ПРИЛОЖЕНИЯ (vite build / dev)
  granum.config.ts + инстанс движка ──► резолвер ──► Resolution ──► ./vite ──┬─► JS:  virtual:granum/components, guard
        ▲                                                                    ├─► CSS: движок + сборщик @layer → virtual:granum.css
  манифесты провайдеров (через exports пакета)                               └─► токены: prune, манифест тем → virtual:granum/themes → ./runtime
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
| `./engine` | browser + node | интерфейс `GranumEngine`, типы правил, `extractClasses`, `parseDialect`, `vocabularyFingerprint` |
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

Реализации движка в ядре нет вовсе: `./engine` отдаёт контракт и хелперы
авторам движков, а инстанс приходит из `granum.config.*`. Штатная реализация —
`@feugene/granum-engine-mini`: вендоренное ядро UnoCSS 66.7.5 (`@unocss/core`,
`preset-mini`, `rule-utils` без `magic-string`,
`extractor-arbitrary-variants`) плюс перенесённые правила
`unocss-mini-extra-rules`; golden-тест против живого `unocss@66.7.5` живёт там
же, рядом с вендоренным кодом.

```ts
interface GranumEngine {
  name: string
  version?: string
  dialect: string      // имя словаря: по нему грузятся правила провайдеров
  vocabulary: string   // отпечаток набора имён: по нему решается доверие манифесту
  extract: (code: string, id: string) => ReadonlySet<string>
  generate: (input: EngineInput) => Promise<EngineOutput>   // { css, matched, unmatched }
}
```

Движок чист и детерминирован; каждый класс входа попадает либо в `matched`
(с правилом, источником и слоем), либо в `unmatched` — молча не отбрасывается
ничего. Код движка живёт на сборке и в клиентский бандл приложения не попадает.

Место движка в потоке данных изменилось: он больше не часть пакета. Сборка
провайдера прогоняет тот движок, которым её запустили, и пишет в манифест его
диалект и отпечаток словаря — как факт о происхождении списка классов.
Приложение до генерации CSS сверяет с ними свой движок и решает: верить списку
или пересчитать классы из файлов манифеста. Модель целиком — в
[движках и диалектах](./engines-and-dialects.md).

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
