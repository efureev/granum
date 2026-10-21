import { createApp } from 'vue'
import App from './App.vue'
// Сброс и оболочка стенда — раньше CSS granum: слои, объявленные первыми, проигрывают его слоям.
import '../../shared/demo.css'
// Общий лист: основная тема и компоненты. Листы дополнительных тем грузит контроллер по выбору.
import 'virtual:granum.css'

createApp(App).mount('#app')
