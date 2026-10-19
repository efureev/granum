# `fixtures/themes-package`

Владелец тем без компонентов (C-32): реестр токенов, каталог из двух тем и
тема-независимые формулы. На нём стоят стенды тем и режимов granum 3.

```
src/
  themes/registry.json   th-bg, th-fg, th-accent, th-accent-fg, th-line → mode; th-radius, th-font → root
  themes/paper.json      «Бумага»: light (по умолчанию), dark; формула в root, фолбэк @supports
  themes/ink.json        «Чернила»: только отличия от paper и режим dim, наследующий dark
  styles/tokens.css      тема-независимая формула под :root, [data-theme]
```

`ink` в исходниках неполон: сборка провайдера дополняет его данными `paper`
(`extends` в каталоге) и проверяет по реестру — в `dist/themes/ink.json` уже
полные данные.

```bash
yarn workspace @granum-fixtures/themes build
yarn workspace @granum-fixtures/themes verify
```
