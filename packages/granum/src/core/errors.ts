/**
 * Типизированные ошибки ядра (ТЗ §14, INV-ERR-2). Каждая наследует
 * {@link GranumError} и несёт машинно-читаемый `code` плюс структурные поля;
 * сообщение — на английском, для человека.
 */

export abstract class GranumError extends Error {
  abstract readonly code: string

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
  }
}

export class ProviderNotRegisteredError extends GranumError {
  readonly code = 'provider-not-registered' as const

  constructor(
    readonly providerId: string,
    readonly referencedBy?: string,
  ) {
    const from = referencedBy ? ` (referenced by '${referencedBy}')` : ''
    super(`Provider '${providerId}' is not registered${from}. Add it to the 'providers' option.`)
  }
}

export class ComponentNotFoundError extends GranumError {
  readonly code = 'component-not-found' as const

  constructor(
    readonly providerId: string,
    readonly componentName: string,
    readonly available: readonly string[],
    readonly referencedBy?: string,
  ) {
    const from = referencedBy ? ` (referenced by '${referencedBy}')` : ''
    super(
      `Component '${providerId}:${componentName}' not found${from}. `
      + `Available in '${providerId}': [${available.join(', ')}].`,
    )
  }
}

/**
 * Строковый элемент селекции не разбирается как `providerId:Name`: разделитель —
 * ПОСЛЕДНЕЕ двоеточие, обе стороны непустые (INV-SEL-1); короткая форма `'Name'`
 * допустима только в `dependencies` компонента (INV-SEL-4).
 */
export class InvalidComponentKeyError extends GranumError {
  readonly code = 'invalid-component-key' as const

  constructor(readonly key: string) {
    super(
      `Invalid component key '${key}': expected 'providerId:ComponentName' `
      + `(short form 'Name' is only allowed inside a component's 'dependencies').`,
    )
  }
}

export class CircularDependencyError extends GranumError {
  readonly code = 'circular-component-dependency' as const

  constructor(readonly chain: readonly string[]) {
    super(`Circular component dependency detected: ${chain.join(' -> ')}`)
  }
}

export class DuplicateProviderIdError extends GranumError {
  readonly code = 'duplicate-provider-id' as const

  constructor(
    readonly providerId: string,
    readonly path?: readonly string[],
  ) {
    const where = path && path.length > 0 ? ` (at ${path.join(' -> ')})` : ''
    super(
      `Duplicate provider id '${providerId}'${where}: two different provider instances share one id `
      + `(possibly a version or build conflict).`,
    )
  }
}

export class UnsupportedContractVersionError extends GranumError {
  readonly code = 'unsupported-contract-version' as const

  constructor(
    readonly providerId: string,
    readonly version: unknown,
    readonly supported: number,
  ) {
    super(
      `Provider '${providerId}' declares 'contractVersion: ${String(version)}', `
      + `but this package supports version ${supported}. Upgrade '@feugene/granum' or the provider so they match.`,
    )
  }
}

export class DuplicateComponentNameError extends GranumError {
  readonly code = 'duplicate-component-name' as const

  constructor(
    readonly providerId: string,
    readonly componentName: string,
  ) {
    super(
      `Provider '${providerId}' declares two components named '${componentName}'. `
      + `Component names must be unique within a provider.`,
    )
  }
}

/** Имя компонента — одновременно сегмент пути `components/<Name>/` (INV-CON-2). */
export class InvalidComponentNameError extends GranumError {
  readonly code = 'invalid-component-name' as const

  constructor(
    readonly providerId: string,
    readonly componentName: string,
  ) {
    super(
      `Provider '${providerId}' declares component '${componentName}', which is not a valid path segment: `
      + `expected /^[A-Za-z][\\w-]*$/ (it becomes the directory 'components/<Name>/').`,
    )
  }
}

/** Ключ токена с `--`: генератор добавляет префикс сам, а `----x` молча ломает тему (INV-CON-7). */
export class InvalidTokenKeyError extends GranumError {
  readonly code = 'invalid-token-key' as const

  constructor(
    readonly providerId: string,
    readonly token: string,
    readonly theme: string,
    readonly componentName?: string,
  ) {
    const where = componentName ? `component '${componentName}' of provider '${providerId}'` : `provider '${providerId}'`
    super(
      `Token key '${token}' (theme '${theme}', ${where}) must not start with '--': `
      + `the prefix is added by the generator, and '--${token}' would silently become an unusable custom property.`,
    )
  }
}

export class CircularProviderDependencyError extends GranumError {
  readonly code = 'circular-provider-dependency' as const

  constructor(readonly chain: readonly string[]) {
    super(`Circular provider dependency detected: ${chain.join(' -> ')}`)
  }
}

export class UnresolvedProviderDependencyError extends GranumError {
  readonly code = 'unresolved-provider-dependency' as const

  constructor(
    readonly providerId: string,
    readonly referencedBy: string,
  ) {
    super(
      `Provider '${referencedBy}' declares a dependency on '${providerId}', `
      + `but no provider with this id is registered. Add it to 'providers' or pass its instance in 'dependencies'.`,
    )
  }
}

/** Причина, по которой провайдер не проходит проверку при регистрации. */
export type InvalidProviderReason
  = | 'invalid-id'
    | 'invalid-base-url'
    | 'base-url-not-a-directory'
    | 'invalid-components'
    | 'invalid-dependency'
    | 'css-file-escapes-component'

/**
 * Провайдер объявлен некорректно. Бросается при регистрации (INV-ERR-1), а не
 * тогда, когда некорректное значение впервые понадобится сборке.
 */
export class InvalidProviderError extends GranumError {
  readonly code = 'invalid-provider' as const

  constructor(
    readonly providerId: string,
    readonly reason: InvalidProviderReason,
    details: string,
    readonly componentName?: string,
  ) {
    const where = componentName ? `component '${componentName}' of ` : ''
    super(`Invalid provider: ${where}'${providerId}' — ${details}`)
  }
}
