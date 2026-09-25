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
    | 'missing-source-url'
    | 'missing-component-entry'

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

/** Версия формата манифеста, которую этот пакет не понимает (INV-MAN-3). */
export class UnsupportedManifestVersionError extends GranumError {
  readonly code = 'unsupported-manifest-version' as const

  constructor(
    readonly version: unknown,
    readonly supported: number,
    readonly file?: string,
  ) {
    const where = file ? ` (${file})` : ''
    super(
      `Manifest${where} declares format version ${String(version)}, but this package understands version ${supported}. `
      + `Upgrade '@feugene/granum' or rebuild the provider.`,
    )
  }
}

export type InvalidManifestReason
  = | 'json'
    | 'schema'
    | 'path-escapes-package'
    | 'hash-mismatch'
    | 'entry-layout'
    | 'token-key-prefix'

/** Манифест не проходит проверку читателя (`docs/manifest.md` §4). */
export class InvalidManifestError extends GranumError {
  readonly code = 'invalid-manifest' as const

  constructor(
    readonly reason: InvalidManifestReason,
    details: string,
    /** Путь до поля внутри JSON, если применимо (`components.XhPanel.entry`). */
    readonly path?: string,
    readonly file?: string,
  ) {
    const at = path ? ` at '${path}'` : ''
    const where = file ? ` (${file})` : ''
    super(`Invalid manifest${where}${at}: ${details}`)
  }
}

/** `<pkg>/granum.manifest.json` не разрешается через `exports` пакета (A-2, INV-LAY-2). */
export class ManifestNotFoundError extends GranumError {
  readonly code = 'manifest-not-found' as const

  constructor(
    readonly packageName: string,
    readonly from: string,
    options?: { cause?: unknown },
  ) {
    super(
      `Cannot resolve '${packageName}/granum.manifest.json' from '${from}'. `
      + `The provider must be built with granumProvider() and export './granum.manifest.json' in package.json — run 'granum codegen' in the provider.`,
      options,
    )
  }
}

/** Источник CSS невозможно прочитать в принципе: не-file протокол или битый data-URL. */
export class CssSourceError extends GranumError {
  readonly code = 'css-source' as const

  constructor(
    readonly source: string,
    readonly reason: 'unsupported-protocol' | 'invalid-data-url',
  ) {
    super(reason === 'unsupported-protocol'
      ? `Cannot read CSS from a non-file URL '${source}'. Only local paths, 'file://' URLs and 'data:text/css' URLs are supported.`
      : `Unsupported CSS data URL: ${source.slice(0, 64)}…`)
  }
}

/** CSS-файл, объявленный провайдером, не читается; провайдер, секция и субъект — в полях. */
export class CssReadError extends GranumError {
  readonly code = 'css-read' as const

  constructor(
    readonly providerId: string,
    readonly section: 'base' | 'tokens' | 'theme' | 'component',
    readonly subject: string,
    readonly path: string,
    options?: { cause?: unknown },
  ) {
    const what = section === 'theme' ? `theme '${subject}'` : section === 'component' ? `component '${subject}'` : `${section} css`
    super(`Cannot read ${what} of provider '${providerId}': ${path}`, options)
  }
}

/** Отказ строгого разбора CSS с токенами: файл не даёт того, что просили. */
export class TokenParseError extends GranumError {
  readonly code = 'token-parse' as const

  constructor(
    message: string,
    readonly source: string,
    readonly reason: 'unsupported-blocks' | 'no-tokens' | 'selector-not-found',
    readonly available?: readonly string[],
  ) {
    super(message)
  }
}

/** Ссылка `tokenDefinitionsRef` не читается; провайдер, компонент и тема — в полях. */
export class TokenRefError extends GranumError {
  readonly code = 'token-ref' as const

  constructor(
    readonly providerId: string,
    readonly themeName: string,
    readonly componentName: string | undefined,
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    const where = componentName ? `component '${componentName}' of provider '${providerId}'` : `provider '${providerId}'`
    super(
      `Failed to resolve tokenDefinitionsRef['${themeName}'] declared by ${where}: ${url}${
        options?.cause instanceof Error ? ` (${options.cause.message})` : ''}`,
      options,
    )
  }
}

/** Фактический импорт между компонентами не покрыт объявленным графом `dependencies` (INV-CON-5). */
export class UndeclaredDependencyError extends GranumError {
  readonly code = 'undeclared-dependency' as const

  constructor(
    readonly providerId: string,
    /** `[компонент, чей код импортирует, ключ импортируемого]`. */
    readonly edges: readonly (readonly [from: string, to: string])[],
  ) {
    super(
      `Provider '${providerId}' ships imports that its component graph does not declare: `
      + `${edges.map(([from, to]) => `${from} → ${to}`).join(', ')}. `
      + `Add the imported component to 'dependencies' of the importer (or remove the import).`,
    )
  }
}

/** `package.json#exports` провайдера не публикует манифест или subpath компонента (B-13, INV-LAY-2). */
export class PackageExportsError extends GranumError {
  readonly code = 'package-exports' as const

  constructor(
    readonly providerId: string,
    readonly missing: readonly string[],
  ) {
    super(
      `package.json of '${providerId}' does not export ${missing.map(m => `'${m}'`).join(', ')}. `
      + `Run 'granum codegen' (codegenTargets.packageExports) or add the entries by hand.`,
    )
  }
}

/** Браузерный чанк провайдера тянет node-код (INV-BND-1) или `data:`-URL вместо пути (INV-LAY-3). */
export class BoundaryViolationError extends GranumError {
  readonly code = 'boundary-violation' as const

  constructor(
    readonly providerId: string,
    readonly violations: readonly { readonly file: string, readonly specifier: string, readonly kind: 'node-import' | 'granum-node-entry' | 'data-url' }[],
  ) {
    super(
      `Browser bundle of '${providerId}' crosses the browser/node boundary: ${
        violations.map(v => `${v.file}: ${v.kind} '${v.specifier}'`).join('; ')}`,
    )
  }
}

/** `@apply` в CSS компонента нельзя раскрыть плоско (ADR-3). */
export class ApplyExpansionError extends GranumError {
  readonly code = 'apply-expansion' as const

  constructor(
    readonly file: string,
    readonly reason: 'unmatched-class' | 'non-flat-rule' | 'nested-context',
    readonly detail: string,
  ) {
    super(`Cannot expand @apply in ${file}: ${detail}`)
  }
}

/** Причина, по которой генерация реестров не может продолжаться. */
export type GranumCodegenReason
  = | 'config-export-name-mismatch'
    | 'missing-open-marker'
    | 'missing-close-marker'
    | 'missing-package-exports'
    | 'no-component-exports'
    | 'missing-components-dir'
    | 'duplicate-component-name'
    | 'subcomponent-name-clash'

/** Генерация реестров провалилась; вызывающий отличает «реестры разошлись» от «сломалась оснастка» по `reason`. */
export class GranumCodegenError extends GranumError {
  readonly code = 'codegen' as const

  constructor(
    readonly reason: GranumCodegenReason,
    message: string,
    /** Файл, на котором генерация остановилась (если применимо). */
    readonly file?: string,
  ) {
    super(message)
  }
}
