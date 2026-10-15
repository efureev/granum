import { defineGranumComponent } from '@feugene/granum/contract'

/** Имя токена собирается в рантайме из общего модуля `chunks/` — объявлено `dynamicTokens`. */
export const xhOverlayConfig = defineGranumComponent(import.meta.url, {
  name: 'XhOverlay',
  dynamicTokens: ['xh-z-dropdown'],
})
