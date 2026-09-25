import { createApp } from 'vue'
import App from './App.vue'

// Ни одного CSS-импорта: у стенда нет ни ресета, ни granum. Всё, что есть в
// `bench-one` сверх этого, и есть цена библиотеки.
createApp(App).mount('#app')
