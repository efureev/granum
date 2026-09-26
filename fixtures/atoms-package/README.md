# `@granum-fixtures/atoms`

Провайдер на **своём словаре утилит** — диалект `granum-fixtures/atoms@1`.
Собирается движком [`@granum-engines/atoms`](../atoms-engine), правила пакета
уезжают отдельным модулем `dist/granum-provider/engine.js`.

Что на нём проверяется:

| Что | Где видно |
|---|---|
| диалект и отпечаток артефакта записаны как факт | `engine` в `dist/granum.manifest.json` |
| правила пакета не встраиваются в JSON, а едут модулем | `engine.module`, `granum-provider/engine.js` |
| у приложения того же диалекта правила загружаются | [`app-atoms`](../../apps/app-atoms) |
| у приложения чужого диалекта — нет, и классы честно непокрыты | `dialects.test.ts`, ветка `engine-rules-skipped` |

Ни одно имя словаря не пересекается с preset-mini: `atom-stack`, `atom-inline`,
`atom-fill`, `atom-gap-<n>`, `atom-pad-<n>`, `atom-bg-[…]` плюс `atom-frame` и
`atom-round` из правил пакета. Поэтому расхождение диалектов видно сразу, а не
в виде «похоже, но не то».
