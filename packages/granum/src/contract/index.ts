/**
 * Контракт провайдера granum, версия 1 (ТЗ §5).
 *
 * Единственная точка входа, которую импортирует браузерный код провайдера.
 * Обязана оставаться без `node:`-импортов (INV-BND-1) и без внешних
 * зависимостей (INV-DEP-1). Типы и `define*`-хелперы заполняются на этапе 1.
 */

/** Версия контракта провайдера, поддерживаемая этим пакетом (C-2, INV-CON-3). */
export const GRANUM_CONTRACT_VERSION = 1 as const

export type GranumContractVersion = typeof GRANUM_CONTRACT_VERSION
