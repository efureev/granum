/**
 * Локальные объявления виртуальных модулей granum: пакет их не поставляет, а
 * без них редактор считает импорт ошибкой. Форма повторяет то, что отдаёт
 * плагин: именованный экспорт на каждый компонент селекции (A-5).
 */
declare module 'virtual:granum/components' {
  import type { DefineComponent } from 'vue'

  export const XxCard: DefineComponent
  export const XxBadge: DefineComponent
}

declare module 'virtual:granum.css' {}
