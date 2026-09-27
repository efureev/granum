import type { GranumActiveTheme } from './theme'
import { createThemeController } from '@feugene/granum/runtime'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'
import manifest from 'virtual:granum/themes'
import App from './App.vue'
import { activeThemeKey, pickTheme, rootAttributes } from './theme'

/*
 * Манифест тем и чистые функции работы с ним реэкспортируются намеренно.
 *
 * Серверный бандл — единственный артефакт стенда, который можно импортировать
 * в Node, а проверять надо ТОТ ЖЕ код, которым пользуется клиент, а не его
 * копию в тесте. Поэтому `scripts/verify-ssr.mjs` берёт их отсюда.
 */
export { readActiveTheme, rootAttributes } from './theme'
export { manifest as themeManifest }

/**
 * Литерал, который сервер заменяет в шаблоне, чтобы поставить тему на корень.
 *
 * Вынесен в константу и проверяется стендом: подстановка строкой хрупка ровно
 * до тех пор, пока никто не сверяет, что подставлять есть во что. Правка
 * `index.html` без правки этой строки уронит проверку, а не тему в проде.
 */
export const ROOT_TAG = '<html lang="ru">'

export interface RenderResult {
  /** Разметка приложения — её кладут внутрь контейнера гидрации. */
  readonly html: string
  /** Открывающий тег корня с активацией темы. */
  readonly rootTag: string
  readonly theme: string
}

/**
 * Серверный рендер одного ответа.
 *
 * Контроллер тем создаётся здесь намеренно, хотя применять ему нечего: так
 * проверяется, что `@feugene/granum/runtime` живёт в Node без DOM. Он же
 * валидирует имя темы по манифесту — тому самому, который собрал granum из
 * резолюции, давшей CSS.
 */
export async function render(url: string): Promise<RenderResult> {
  const requested = new URL(url, 'http://ssr.local').searchParams.get('theme')
  const name = pickTheme(manifest, requested)

  // `target: undefined` и `storage: null` — на сервере применять и запоминать
  // нечего; контроллер нужен ради проверки имени и ради самого факта, что он
  // конструируется без DOM.
  const controller = createThemeController(manifest, { target: undefined, storage: null, initial: name })

  const active: GranumActiveTheme = {
    name: controller.get(),
    list: controller.list(),
    set: () => {},
  }

  const app = createSSRApp(App)
  app.provide(activeThemeKey, active)

  return {
    html: await renderToString(app),
    rootTag: `<html lang="ru"${rootAttributes(manifest, active.name)}>`,
    theme: active.name,
  }
}
