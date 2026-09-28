import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Стенд JS-канала: `virtual:granum/components` на настоящей сборке (A-5, INV-JS-1).
 *
 * В селекции ОБА компонента пакета, а приложение импортирует из виртуального
 * модуля один. Так стенд показывает то, чего не видно нигде больше: JS идёт по
 * импортам, CSS — по селекции. Код невыбранного компонента вырезает
 * tree-shaking, потому что модуль состоит из одних реэкспортов и не имеет
 * побочных эффектов; его классы при этом в CSS остаются — за них отвечает
 * селекция, а её никто не сужал.
 *
 * Обрезка токенов выключена намеренно: предмет стенда — JS, и лишняя машинерия
 * между утверждением и фактом здесь ни к чему.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/mini-ds'],
  components: 'all',
  themes: { names: ['light'] },
  appSources: { dirs: ['src'] },
})
