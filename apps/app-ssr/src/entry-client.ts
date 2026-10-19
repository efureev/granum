import type { GranumActiveMode } from './theme'
import { createCookieStorage, createThemeController } from '@feugene/granum/runtime'
import { createSSRApp, ref } from 'vue'
import manifest from 'virtual:granum/themes'
import App from './App.vue'
import { activeModeKey } from './theme'

// Сброс и оболочка стенда — раньше CSS granum: слои, объявленные первыми, проигрывают его слоям.
import '../../shared/demo.css'
// Весь CSS granum одним модулем: пять каскадных слоёв. Импортирует его ТОЛЬКО
// клиентский вход — серверу стили не нужны, он отдаёт ссылку на готовый ассет.
import 'virtual:granum.css'

/**
 * Режим не выбираем заново: его выбрал сервер и записал парой в корень
 * документа. Контроллер узнаёт пару и корень не трогает, поэтому первый
 * клиентский кадр совпадает с серверным. Выбор пользователя уезжает в cookie:
 * следующий запрос сервер отрендерит уже в нём.
 */
const controller = createThemeController(manifest, { storage: createCookieStorage() })

const current = ref(controller.mode)
controller.subscribe(name => (current.value = name))

const active: GranumActiveMode = {
  get name() {
    return current.value
  },
  list: controller.modes().map(mode => mode.name),
  set: name => controller.setMode(name),
}

const app = createSSRApp(App)
app.provide(activeModeKey, active)
app.mount('#app')
