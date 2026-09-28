/**
 * Объявления виртуальных модулей granum для TypeScript.
 *
 * Подключается один раз в приложении — ссылкой в любом `.d.ts`:
 *
 *     /// <reference types="@feugene/granum/client" />
 *
 * или через `compilerOptions.types: ['@feugene/granum/client']` в `tsconfig`.
 *
 * `virtual:granum/components` здесь объявлен без имён и намеренно: имена
 * реэкспортов зависят от селекции конкретного приложения, а не от пакета, и
 * выразить их амбиентно нельзя. Точные объявления порождает сам плагин —
 * `js: { dts: 'src/granum.d.ts' }`, — как `components.d.ts` у авто-импорта.
 * Пока их нет, импорт отсюда типизирован как `any`: код собирается, проверки
 * пропсов нет.
 */

declare module 'virtual:granum.css' {}

declare module 'virtual:granum/layers/tokens.css' {}
declare module 'virtual:granum/layers/base.css' {}
declare module 'virtual:granum/layers/themes.css' {}
declare module 'virtual:granum/layers/components.css' {}
declare module 'virtual:granum/layers/utilities.css' {}

declare module 'virtual:granum/themes' {
  import type { GranumThemeManifest } from '@feugene/granum/runtime'

  /** Манифест тем селекции: порядок блоков в CSS и тема по умолчанию (T-4). */
  const manifest: GranumThemeManifest
  export default manifest
}

declare module 'virtual:granum/components'
