/**
 * Заглушка для API, которое объявлено в ТЗ, но реализуется на более позднем
 * этапе плана. Бросает типизированную ошибку с именем API и этапом — вместо
 * `undefined`-экспорта, который потребитель обнаружил бы в рантайме.
 */
export class GranumNotImplementedError extends Error {
  readonly code = 'not-implemented' as const

  constructor(readonly api: string, readonly stage: string) {
    super(`${api} is not implemented yet (planned for ${stage})`)
    this.name = 'GranumNotImplementedError'
  }
}

export function notImplemented(api: string, stage: string): never {
  throw new GranumNotImplementedError(api, stage)
}
