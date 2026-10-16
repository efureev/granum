import 'virtual:granum.css'
import css from './raw.css?raw'

// Так лист вставляет портал granularity: строкой в `<style>`, без отдельного запроса.
const style = document.createElement('style')
style.textContent = css
document.head.append(style)
