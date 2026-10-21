import { defineGranumConfig } from '@feugene/granum/vite'
import { loadThemeSource } from '@feugene/granum/node'
import { windEngine } from '@feugene/granum-engine-wind'
import tide from '@granum-fixtures/theme-tide'

/**
 * Темы одной сборки из трёх мест.
 *
 * - Пакет компонентов `@granum-fixtures/valued-ds`: «Камень» — его базовая тема,
 *   «Мох» — копия «Камня», «Угли» — наследник. Основную тему выбирает
 *   приложение: темы по умолчанию у каталога нет.
 * - Отдельный пакет темы `@granum-fixtures/theme-tide`: тема-объект, которая
 *   наследует «Камень» живьём — granum раскрывает `extends` от установленного
 *   пакета компонентов (A-22).
 * - Своя тема приложения «Риф» — исходник поверх «Мха».
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/valued-ds'],
  themes: [
    { theme: 'stone', default: true, modes: ['light', 'dark'] },
    { theme: 'moss', modes: ['light', 'dark'] },
    { theme: 'ember', modes: ['light', 'dark'] },
    { theme: tide, modes: ['light', 'dark'] },
    { theme: loadThemeSource(new URL('./src/themes/reef/', import.meta.url)), modes: ['light'] },
  ],
  appSources: { dirs: ['src'] },
})
