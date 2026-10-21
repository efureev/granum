# `fixtures/theme-tide-package`

Тема, выпущенная отдельно от компонентов, которые она красит. Пакет отдаёт
тему-объект (A-22): приложение кладёт её в `themes`, и granum раскрывает
`extends: 'stone'` от установленной темы каталога `@granum-fixtures/valued-ds` —
правки «Камня» приходят в «Прилив» на следующей сборке приложения. `version` и
`targets` говорят, под какие версии пакета компонентов тема написана (C-41):
выход за диапазон — предупреждение сборки и находка `doctor` (A-38).

```bash
yarn workspace @granum-fixtures/theme-tide build
yarn workspace @granum-fixtures/theme-tide verify
```
