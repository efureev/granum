/**
 * Версия пакета, подставляемая бандлером (`define` в `vite.config.ts`) и тестами
 * (`vitest.config.ts`). В чистом TS-окружении константа не определена — за это
 * отвечает `version.ts`.
 */
declare const __GRANUM_VERSION__: string | undefined
