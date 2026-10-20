import { createApp } from 'vue'
import Previews from './Previews.vue'
import '../../shared/demo.css'
import 'virtual:granum.css'
// Блоки темы превью — только на этой странице.
import 'virtual:granum/previews.css'

createApp(Previews).mount('#app')
