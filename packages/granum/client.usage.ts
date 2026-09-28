/**
 * Потребитель амбиентных объявлений `@feugene/granum/client` — файл существует
 * только ради проверки типов (`yarn typecheck:client`) и в пакет не уезжает.
 *
 * Проверять `client.d.ts` одним лишь включением в `tsconfig` мало: `declare
 * module` без потребителя компилируется всегда, даже когда объявляет не то, что
 * отдаёт плагин. Поэтому здесь каждый виртуальный модуль импортируется так же,
 * как его импортирует приложение.
 */
/// <reference path="./client.d.ts" />

// Имён компонентов в амбиентных объявлениях нет и быть не может: они зависят от
// селекции приложения. Импорт отсюда типизирован как `any` — это заявленное
// поведение, а точные объявления порождает плагин (`js.dts`).
import { XhPanel } from 'virtual:granum/components'
import manifest from 'virtual:granum/themes'
import 'virtual:granum.css'
import 'virtual:granum/layers/base.css'
import 'virtual:granum/layers/components.css'
import 'virtual:granum/layers/themes.css'
import 'virtual:granum/layers/tokens.css'
import 'virtual:granum/layers/utilities.css'

/** Манифест тем типизирован по-настоящему: поля читаются, а не `any`. */
export const defaultTheme: string = manifest.defaultTheme
export const firstThemeName: string | undefined = manifest.themes[0]?.name
export const firstSelectors: readonly string[] = manifest.themes[0]?.selectors ?? []
export const anyComponent: unknown = XhPanel
