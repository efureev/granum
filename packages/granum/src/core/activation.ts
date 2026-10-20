/**
 * Активация режима по умолчанию — одна для сборки и для рантайма. Отдельный
 * модуль без импортов: `./runtime` берёт отсюда две строки и не тянет за ними
 * в браузер код данных тем.
 */
export const DEFAULT_ACTIVATION_ATTRIBUTE = 'data-theme'
export const DEFAULT_ACTIVATION_VALUE = '{theme}-{mode}'
