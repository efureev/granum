import { createApp } from 'vue'
import Previews from './Previews.vue'
import '../../shared/demo.css'
import 'virtual:granum.css'
// Лист дополнительной темы — только на этой странице.
import 'virtual:granum/themes/ink.css'

createApp(Previews).mount('#app')
