import { createApp } from 'vue'
import App from './App.vue'
import 'virtual:granum.css'
// Тема применяется до первого рендера — иначе на старте мелькнёт чужая.
import './theme'

createApp(App).mount('#app')
