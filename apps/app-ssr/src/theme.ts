import type { GranumThemeManifest } from '@feugene/granum/runtime'
import type { InjectionKey } from 'vue'

/**
 * Активная тема, которую разметка получает одинаково на сервере и в браузере.
 *
 * Контроллер тем из `@feugene/granum/runtime` — вещь браузерная: он приводит DOM
 * в состояние, при котором нужный блок токенов начинает совпадать. На сервере
 * DOM нет, а разметка обязана получиться той же, иначе гидрация поедет. Поэтому
 * компоненты берут не контроллер, а вот этот минимальный интерфейс: имя
 * активной темы плюс способ её сменить. На сервере смена — пустая операция.
 */
export interface GranumActiveTheme {
  readonly name: string
  readonly list: readonly string[]
  readonly set: (name: string) => void
}

export const activeThemeKey = Symbol('granum:active-theme') as InjectionKey<GranumActiveTheme>

/**
 * Имя темы из запроса, сверенное с манифестом сборки.
 *
 * Сверка обязательна: список тем задаёт `themes.names` конфига, и в CSS есть
 * только они. Имя не из манифеста означает, что блока токенов под него не
 * эмитировано, и активировать нечего — в такой ситуации отдаём тему по
 * умолчанию, а не пустой экран без токенов.
 */
export function pickTheme(manifest: GranumThemeManifest, requested: string | null | undefined): string {
  const known = manifest.themes.some(theme => theme.name === requested)
  return known && requested ? requested : manifest.defaultTheme
}

/** Минимум от корневого элемента, нужный для чтения активной темы. */
export interface GranumThemeRoot {
  readonly getAttribute: (name: string) => string | null
  readonly classList: { readonly contains: (token: string) => boolean }
}

/**
 * Какая тема уже активна на корне документа.
 *
 * Это обратная операция к {@link rootAttributes}: сервер записал активацию в
 * разметку, браузер читает её обратно. Так клиент не выбирает тему заново, а
 * поднимает контроллер поверх уже применённого состояния — первый клиентский
 * кадр совпадает с серверным, и вспышки чужой темы не бывает.
 */
export function readActiveTheme(manifest: GranumThemeManifest, root: GranumThemeRoot): string {
  for (const theme of manifest.themes) {
    const { activation } = theme
    if (activation.type === 'attribute' && root.getAttribute(activation.name) === activation.value)
      return theme.name
    if (activation.type === 'class' && root.classList.contains(activation.value))
      return theme.name
  }
  return manifest.defaultTheme
}

/**
 * Атрибуты корневого элемента, при которых тема активна.
 *
 * Знание о селекторах живёт в манифесте, который собрал granum из той же
 * резолюции, из которой эмитил CSS. Здесь оно превращается в строку для
 * серверного шаблона.
 *
 * Тема с активацией `root` не требует ничего: её токены эмитированы под
 * `:root`, и она активна, пока не активирована другая. Это не «нет темы», а
 * полноценное состояние — поэтому пустая строка здесь законный результат.
 */
export function rootAttributes(manifest: GranumThemeManifest, name: string): string {
  const theme = manifest.themes.find(entry => entry.name === name)
  if (!theme)
    return ''
  const { activation } = theme
  if (activation.type === 'attribute')
    return ` ${activation.name}="${activation.value}"`
  if (activation.type === 'class')
    return ` class="${activation.value}"`
  return ''
}
