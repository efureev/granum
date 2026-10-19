import { createApp } from 'vue'
import App from './App.vue'
// Сброс и оболочка стенда — раньше CSS granum: слои, объявленные первыми, проигрывают его слоям.
import '../../shared/demo.css'
import 'virtual:granum.css'
import './theme'

createApp(App).mount('#app')
