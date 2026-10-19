import type { GranumThemeManifest } from '@feugene/granum/runtime'
import type { InjectionKey } from 'vue'
import { modeFromCookie, resolveThemeActivation, themeRootAttributes } from '@feugene/granum/runtime'

/**
 * Активный режим, который разметка получает одинаково на сервере и в браузере.
 *
 * Контроллер режимов из `@feugene/granum/runtime` — вещь браузерная: он ставит
 * пару в атрибут корня. На сервере DOM нет, а разметка обязана получиться той
 * же, иначе гидрация поедет. Поэтому компоненты берут не контроллер, а этот
 * минимальный интерфейс: имя активного режима плюс способ его сменить. На
 * сервере смена — пустая операция.
 */
export interface GranumActiveMode {
  readonly name: string
  readonly list: readonly string[]
  readonly set: (name: string) => void
}

export const activeModeKey = Symbol('granum:active-mode') as InjectionKey<GranumActiveMode>

/**
 * Режим ответа: из запроса, иначе из cookie (`createCookieStorage` на клиенте),
 * иначе режим по умолчанию. Имя сверяется с манифестом: блоки CSS есть только у
 * режимов сборки, и неизвестное имя не должно дать страницу без токенов.
 */
export function pickMode(manifest: GranumThemeManifest, requested: string | null | undefined, cookieHeader?: string | null): string {
  if (requested && manifest.modes.some(mode => mode.name === requested))
    return requested
  return modeFromCookie(manifest, cookieHeader)?.name ?? manifest.defaultMode
}

/** Минимум от корневого элемента, нужный для чтения режима. */
export interface GranumModeRoot {
  readonly getAttribute: (name: string) => string | null
}

/**
 * Какой режим уже выставлен на корне документа — обратная операция к
 * {@link rootAttributes}: сервер записал пару, браузер читает её обратно.
 */
export function readActiveMode(manifest: GranumThemeManifest, root: GranumModeRoot): string {
  return resolveThemeActivation(manifest, root.getAttribute(manifest.activation.attribute))?.name ?? manifest.defaultMode
}

/** Атрибуты корневого элемента для режима — строкой для серверного шаблона. */
export function rootAttributes(manifest: GranumThemeManifest, name: string): string {
  return Object.entries(themeRootAttributes(manifest, name)).map(([attribute, value]) => ` ${attribute}="${value}"`).join('')
}
