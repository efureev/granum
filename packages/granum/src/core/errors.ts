/**
 * Типизированные ошибки ядра. Каждая наследует
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

  /** `partOf` — владелец, если имя принадлежит части составного компонента: выбирать надо его. */
  constructor(
    readonly providerId: string,
    readonly componentName: string,
    readonly available: readonly string[],
    readonly referencedBy?: string,
    readonly partOf?: string,
  ) {
    const from = referencedBy ? ` (referenced by '${referencedBy}')` : ''
    const part = partOf ? `'${componentName}' is a part of '${providerId}:${partOf}' — select '${providerId}:${partOf}' instead. ` : ''
    super(
      `Component '${providerId}:${componentName}' not found${from}. ${part}`
      + `Available in '${providerId}': [${available.join(', ')}].`,
    )
  }
}

/**
 * Строковый элемент селекции не разбирается как `providerId:Name`: разделитель —
 * ПОСЛЕДНЕЕ двоеточие, обе стороны непустые; короткая форма `'Name'`
 * допустима только в `dependencies` компонента.
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

/** Имя компонента — одновременно сегмент пути `components/<Name>/`. */
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

/** Ключ токена с `--`: генератор добавляет префикс сам, а `----x` молча ломает тему. */
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
    | 'path-escapes-package'
    | 'missing-source-url'
    | 'missing-component-entry'
    | 'invalid-dialect'
    | 'rules-without-dialect'
    | 'invalid-theme-id'
    | 'invalid-mode-name'
    | 'invalid-theme-data'
    | 'default-mode-missing'
    | 'mode-extends-unknown'
    | 'mode-extends-cycle'
    | 'theme-extends-unknown'
    | 'theme-incomplete'
    | 'invalid-theme-dir'
    | 'legacy-token-definitions'
    | 'invalid-theme-version'
    | 'invalid-theme-targets'
    | 'invalid-theme-component-mode'
    | 'theme-token-collision'
    | 'theme-components-untargeted'
    | 'theme-id-mismatch'
    | 'theme-source-unbuilt'

/**
 * Провайдер объявлен некорректно. Бросается при регистрации, а не
 * тогда, когда некорректное значение впервые понадобится сборке.
 */
export class InvalidProviderError extends GranumError {
  readonly code = 'invalid-provider' as const

  constructor(
    readonly providerId: string,
    readonly reason: InvalidProviderReason,
    details: string,
    readonly componentName?: string,
    /** Токены, которых не хватает теме (`theme-incomplete`). */
    readonly tokens?: readonly string[],
  ) {
    const where = componentName ? `component '${componentName}' of ` : ''
    super(`Invalid provider: ${where}'${providerId}' — ${details}`)
  }
}

export type ThemeResolutionReason
  = | 'unknown-theme'
    | 'duplicate-theme'
    | 'default-theme'
    | 'unknown-mode'
    | 'multiple-theme-owners'
    | 'theme-owner-missing'
    | 'theme-missing'
    | 'activation-collision'
    | 'theme-data-missing'
    | 'theme-extends-cycle'

/**
 * Тему или режимы нельзя собрать из конфига и графа. Это ошибка резолюции, а
 * не формы конфига: какие темы доступны, знают только манифесты.
 */
export class ThemeResolutionError extends GranumError {
  readonly code = 'theme-resolution' as const

  constructor(
    readonly reason: ThemeResolutionReason,
    details: string,
    /** Тема, режим или пара, о которых речь. */
    readonly subject?: string,
    /** Доступные варианты: темы каталога, режимы темы, владельцы. */
    readonly available?: readonly string[],
  ) {
    super(`Theme resolution failed (${reason}): ${details}`)
  }
}

/** Данные темы провайдера не читаются или не проходят схему на стороне приложения. */
export class ThemeDataError extends GranumError {
  readonly code = 'theme-data' as const
  /** Причина нарушения формы (`theme-token-collision`, …); у файла, который не читается, — нет. */
  readonly reason?: string

  constructor(
    readonly providerId: string,
    readonly themeId: string,
    readonly path: string,
    details: string,
    options?: { cause?: unknown, reason?: string },
  ) {
    super(`Cannot use the data of theme '${themeId}' of provider '${providerId}' (${path}): ${details}`, options)
    if (options?.reason !== undefined)
      this.reason = options.reason
  }
}

export type ThemeSourceReason
  = | 'theme-json-missing'
    | 'theme-json-invalid'
    | 'token-file-invalid'
    | 'duplicate-value-file'
    | 'unknown-mode-file'
    | 'empty-component-dir'
    | 'unexpected-entry'
    | 'theme-data-invalid'

/**
 * Исходник темы (C-42) не читается: файл или папка, которых раскладка не знает,
 * файл режима не из `theme.json`, пустая папка компонента. Молча пропущенный
 * файл — потерянные значения, поэтому загрузчик строг.
 */
export class ThemeSourceError extends GranumError {
  readonly code = 'theme-source' as const
  /** У `theme-data-invalid` — причина нарушения данных (`theme-components-untargeted`, …). */
  readonly dataReason?: string

  constructor(
    readonly reason: ThemeSourceReason,
    /** Файл или папка, о которых речь. */
    readonly path: string,
    details: string,
    options?: { cause?: unknown, dataReason?: string },
  ) {
    super(`Cannot read the theme source (${path}): ${details}`, options)
    if (options?.dataReason !== undefined)
      this.dataReason = options.dataReason
  }
}

/**
 * Провайдер объявил один словарь, а собирают его движком другого.
 * Записать в манифест чужой диалект нельзя: приложение поверит,
 * что список классов отфильтрован реализацией объявленного словаря, а он
 * отфильтрован другой.
 */
export class EngineDialectMismatchError extends GranumError {
  readonly code = 'engine-dialect-mismatch' as const

  constructor(
    readonly providerId: string,
    readonly declared: string,
    readonly engineDialect: string,
    readonly engineName: string,
  ) {
    super(
      `Provider '${providerId}' declares engine dialect '${declared}', but the build runs on '${engineName}' `
      + `whose dialect is '${engineDialect}'. Pass an engine of the declared dialect to granumProvider({ engine }), `
      + `or drop 'engine.dialect' from the provider to record the build engine's dialect as a fact.`,
    )
  }
}

/** Версия формата манифеста, которую этот пакет не понимает. */
export class UnsupportedManifestVersionError extends GranumError {
  readonly code = 'unsupported-manifest-version' as const

  constructor(
    readonly version: unknown,
    readonly supported: number,
    readonly file?: string,
    note?: string,
  ) {
    const where = file ? ` (${file})` : ''
    super(
      `Manifest${where} declares format version ${String(version)}, but this package understands version ${supported}. ${
        note ?? `Upgrade '@feugene/granum' or rebuild the provider.`}`,
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
    | 'dialect-vocabulary-mismatch'
    | 'dialect-without-classes'

/** Манифест не проходит проверку читателя (`docs/manifest.md`). */
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

/** `<pkg>/granum.manifest.json` не разрешается через `exports` пакета. */
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
    readonly reason: 'unsupported-blocks' | 'no-tokens' | 'selector-not-found' | 'multiple-blocks',
    readonly available?: readonly string[],
  ) {
    super(message)
  }
}

/** Файл токенов (`themesDir` компонента, `modes.define[*].tokensRef`) не читается; провайдер, компонент и тема — в полях. */
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
      `Failed to read the tokens of '${themeName}' declared by ${where}: ${url}${
        options?.cause instanceof Error ? ` (${options.cause.message})` : ''}`,
      options,
    )
  }
}

/** Фактический импорт между компонентами не покрыт объявленным графом `dependencies`. */
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

/** `package.json#exports` провайдера не публикует манифест или subpath компонента. */
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

/** Браузерный чанк провайдера тянет node-код или `data:`-URL вместо пути. */
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

/** `@apply` в CSS компонента нельзя раскрыть плоско. */
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
    | 'no-components-with-prefix'
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

/**
 * Тот же инстанс `granum()` передан во вторую отдельную сборку. Инстанс держит
 * состояние одной сборки — резолюцию, эмиссию, «отчёт написан», — и во второй
 * отдал бы чужие резолюцию и CSS, не написав отчёта. Окружения одного builder
 * Vite (Astro) — одна сборка: их конфиги разрешаются до первой из них.
 */
export class PluginInstanceReusedError extends GranumError {
  readonly code = 'plugin-instance-reused' as const

  constructor(
    readonly previousOutDir: string,
    readonly outDir: string,
  ) {
    super(
      `granum(): this plugin instance has already served a build into '${previousOutDir}', and Vite resolved a config `
      + `for another build into '${outDir}'. Create a new granum(config) for every vite build — a client and an SSR build `
      + `need two instances; the environments of one Vite builder (Astro) share one instance.`,
    )
  }
}

/** Приложение импортирует компонент провайдера, не вошедший в селекцию. */
/**
 * Компонент импортирован из корня пакета-провайдера. Селекция и guard видят
 * компонент по его подпути, а корневой barrel тянет весь пакет: в dev и в SSR
 * это все его компоненты, а CSS компонента, которого нет в селекции, не приедет.
 */
export class ComponentRootImportError extends GranumError {
  readonly code = 'component-root-import' as const

  constructor(
    readonly providerId: string,
    readonly components: readonly string[],
    readonly whole: boolean,
    readonly importer: string | undefined,
  ) {
    const where = importer ? ` in '${importer}'` : ''
    const subject = whole
      ? `The provider package '${providerId}' is imported as a whole${where} (import * as, export * from or import())`
      : `${components.length === 1 ? 'Component' : 'Components'} ${components.map(name => `'${name}'`).join(', ')} `
        + `${components.length === 1 ? 'is' : 'are'} imported from the package root '${providerId}'${where}`
    const instead = whole || components.length === 0
      ? `'${providerId}/components/<Name>'`
      : components.map(name => `'${providerId}/components/${name}'`).join(', ')
    super(
      `${subject}. Import components from ${instead} or from 'virtual:granum/components': granum selects a component `
      + `by its subpath, while the package root loads every component of the package.`,
    )
  }
}

export class ComponentOutsideSelectionError extends GranumError {
  readonly code = 'component-outside-selection' as const

  /** `part` — часть составного компонента, через подпуть которой импортирован владелец `key`. */
  constructor(
    readonly key: string,
    readonly importer: string | undefined,
    readonly selection: readonly string[],
    readonly part?: string,
  ) {
    const from = importer ? ` from '${importer}'` : ''
    const through = part ? ` through its part '${part}',` : ''
    super(
      `Component '${key}' is imported${from}${through} but is not part of the granum selection `
      + `[${selection.join(', ')}]. Add it to 'components' in granum.config (or use components: 'imports').`,
    )
  }
}
