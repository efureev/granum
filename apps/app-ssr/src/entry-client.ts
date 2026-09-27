import type { GranumActiveTheme } from './theme'
import { createThemeController } from '@feugene/granum/runtime'
import { createSSRApp, ref } from 'vue'
import manifest from 'virtual:granum/themes'
import App from './App.vue'
import { activeThemeKey, readActiveTheme } from './theme'

// Весь CSS granum одним модулем: пять каскадных слоёв. Импортирует его ТОЛЬКО
// клиентский вход — серверу стили не нужны, он отдаёт ссылку на готовый ассет.
import 'virtual:granum.css'

/**
 * Тему не выбираем заново: её выбрал сервер и записал в корень документа.
 * Контроллер поднимается поверх уже применённого состояния, поэтому первый
 * клиентский кадр совпадает с серверным и вспышки чужой темы не бывает.
 *
 * `initial` берётся из DOM, а не из `localStorage`: сохранённый выбор
 * пользователя должен был попасть в запрос и повлиять на серверный рендер.
 * Иначе сервер отдал бы одну тему, а клиент немедленно переключил на другую —
 * ровно та вспышка, от которой SSR и уходят.
 */
const controller = createThemeController(manifest, {
  initial: readActiveTheme(manifest, document.documentElement),
})

const current = ref(controller.get())
controller.subscribe(name => (current.value = name))

const active: GranumActiveTheme = {
  get name() {
    return current.value
  },
  list: controller.list(),
  set: name => controller.set(name),
}

const app = createSSRApp(App)
app.provide(activeThemeKey, active)
app.mount('#app')
