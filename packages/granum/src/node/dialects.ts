/**
 * Сверка движка приложения с движком, которым собран каждый пакет (A-E3…A-E8).
 *
 * Список классов в манифесте — не свойство пакета, а результат фильтрации его
 * кандидатов конкретной реализацией движка (B-6). Поэтому доверять списку можно
 * только при совпадении отпечатков словаря: реализация, знающая больше имён,
 * нашла бы в тех же файлах больше классов, и разница пропала бы молча. Диалект
 * решает другой вопрос — грузить ли модуль правил пакета: правило написано
 * против словаря и переживает смену реализации внутри мажора.
 *
 * При любом различии отпечатков классы извлекаются заново из `files` движком
 * приложения. Потерянные при пересчёте имена не выбрасываются: они уезжают в
 * вход движка и остаются видны в `unmatched` (A-E7, INV-DIAG-2).
 */
import type { GranumLoadedManifest, GranumManifest, GranumProvider, GranumProviderInput } from '../contract'
import type { EngineInput, GranumEngine, GranumPreflight, GranumRule, GranumVariant } from '../engine/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLoadedManifest } from '../contract/manifest'
import { sortedUnique } from '../core/dedupe'
import { computeManifestHash } from './manifest'

/** Откуда взят список классов провайдера. */
export type ProviderClassSource = 'manifest' | 're-extracted'

/** Почему список пересчитан: разошлись словари или их реализации. */
export type ReextractReason = 'none' | 'dialect' | 'vocabulary'

export interface ProviderEngineDecision {
  readonly providerId: string
  /** Диалект артефакта; `null` — пакет ни от какого словаря не зависит. */
  readonly dialect: string | null
  /** Отпечаток артефакта; `null` — вместе с диалектом. */
  readonly vocabulary: string | null
  /** Реализация, собравшая пакет; `null` у объектной формы без артефакта. */
  readonly engineName: string | null
  readonly classes: ProviderClassSource
  readonly reason: ReextractReason
  readonly rulesLoaded: boolean
  /** Пакет привёз правила, но их словарь чужой — не загружены (INV-ENG-8). */
  readonly rulesSkipped: boolean
  /** Было в манифесте, не нашлось при пересчёте: движок приложения этих имён не знает. */
  readonly lost: readonly string[]
  /** Нашлось при пересчёте, не было в манифесте: сборка пакета эти имена потеряла. */
  readonly gained: readonly string[]
}

export interface ReconciledProviders {
  /** Входы для резолвера: у пересчитанных провайдеров классы заменены. */
  readonly inputs: readonly GranumProviderInput[]
  readonly decisions: readonly ProviderEngineDecision[]
  /** Правила, варианты и preflights провайдеров, чьи словари совпали с движком приложения. */
  readonly contribution: Pick<EngineInput, 'rules' | 'variants' | 'preflights' | 'sources'>
  /** Классы, потерянные пересчётом: подаются движку, чтобы остаться в `unmatched`. */
  readonly lost: readonly string[]
}

interface EngineModuleShape {
  readonly rules?: readonly GranumRule[]
  readonly variants?: readonly GranumVariant[]
  readonly preflights?: readonly GranumPreflight[]
}

/**
 * Правила объектного провайдера исполняются, только если он не объявил чужой
 * словарь (INV-ENG-8). Не объявил ничего — исполняются: без артефакта утверждать
 * о словаре нечего, и классы всё равно считает движок приложения.
 */
export function objectRulesAllowed(provider: GranumProvider, engine: GranumEngine): boolean {
  const declared = provider.engine?.dialect
  return declared === undefined || declared === engine.dialect
}

function hasRules(shape: EngineModuleShape | undefined): boolean {
  return Boolean(shape?.rules?.length || shape?.variants?.length || shape?.preflights?.length)
}

/**
 * Кэш пересчёта на процесс (A-E8): ключ — хеш манифеста, отпечаток движка и
 * факт загрузки правил пакета. Дисковый кэш намеренно не вводится: пересчёт
 * идёт только при расхождении, а ключ «что именно пересчитывали» на диске
 * пришлось бы инвалидировать руками.
 */
const reextractCache = new Map<string, ReadonlyMap<string, readonly string[]>>()

export function clearReextractCache(): void {
  reextractCache.clear()
}

export async function reconcileProviderEngines(
  inputs: readonly GranumProviderInput[],
  objectSources: readonly GranumProviderInput[],
  engine: GranumEngine,
): Promise<ReconciledProviders> {
  const declaredByObject = new Map<string, GranumProvider>()
  for (const source of objectSources) {
    if (!isLoadedManifest(source))
      declaredByObject.set(source.id, source)
  }

  const rules: GranumRule[] = []
  const variants: GranumVariant[] = []
  const preflights: GranumPreflight[] = []
  const sources = new Map<GranumRule | GranumVariant, string>()
  const tag = (id: string, shape: EngineModuleShape | undefined): void => {
    for (const rule of shape?.rules ?? []) {
      rules.push(rule)
      sources.set(rule, id)
    }
    for (const variant of shape?.variants ?? []) {
      variants.push(variant)
      sources.set(variant, id)
    }
    preflights.push(...(shape?.preflights ?? []))
  }

  const decisions: ProviderEngineDecision[] = []
  const resolverInputs: GranumProviderInput[] = []
  const lost = new Set<string>()

  for (const input of inputs) {
    if (!isLoadedManifest(input)) {
      // Объектная форма без раскладки на диске: артефакта нет, классов тоже
      // (R-6), и сверять нечего — решается только судьба правил.
      const allowed = objectRulesAllowed(input, engine)
      const declares = hasRules(input.engine)
      if (allowed)
        tag(input.id, input.engine)
      decisions.push({
        providerId: input.id,
        dialect: input.engine?.dialect ?? null,
        vocabulary: null,
        engineName: null,
        classes: 'manifest',
        reason: 'none',
        rulesLoaded: allowed && declares,
        rulesSkipped: !allowed && declares,
        lost: [],
        gained: [],
      })
      resolverInputs.push(input)
      continue
    }

    const { manifest } = input
    const artifact = manifest.engine
    const objectForm = declaredByObject.get(manifest.id)
    // Синтетический манифест просканированного объектного провайдера записывает
    // движок приложения — значит, сверять надо утверждение самого объекта.
    const declared = objectForm?.engine?.dialect ?? artifact.dialect
    const sameDialect = declared === null || declared === engine.dialect
    const module = artifact.module

    // Свой вклад пакета держим отдельно от общего: пересчёт обязан идти с теми
    // же правилами, с которыми шла его сборка, а не со всеми правилами графа.
    let own: EngineModuleShape | undefined
    if (objectForm !== undefined)
      own = objectForm.engine
    else if (sameDialect && module !== null)
      own = await importEngineModule(module, input.baseUrl)
    if (sameDialect && own !== undefined)
      tag(manifest.id, own)

    const declaresRules = objectForm !== undefined ? hasRules(objectForm.engine) : module !== null
    const reason: ReextractReason = declared === null
      ? 'none'
      : !sameDialect
          ? 'dialect'
          : artifact.vocabulary !== engine.vocabulary ? 'vocabulary' : 'none'

    if (reason === 'none') {
      decisions.push({
        providerId: manifest.id,
        dialect: artifact.dialect,
        vocabulary: artifact.vocabulary,
        engineName: artifact.name,
        classes: 'manifest',
        reason,
        rulesLoaded: sameDialect && declaresRules,
        rulesSkipped: false,
        lost: [],
        gained: [],
      })
      resolverInputs.push(input)
      continue
    }

    const rulesLoaded = sameDialect && declaresRules
    const reextracted = await reextractProvider(input, engine, rulesLoaded && own
      ? { ...(own.rules ? { rules: own.rules } : {}), ...(own.variants ? { variants: own.variants } : {}) }
      : {})
    const before = new Set(Object.values(manifest.components).flatMap(c => c.classes))
    const after = new Set([...reextracted.values()].flat())
    const providerLost = [...before].filter(c => !after.has(c)).sort()
    const providerGained = [...after].filter(c => !before.has(c)).sort()
    for (const className of providerLost)
      lost.add(className)

    decisions.push({
      providerId: manifest.id,
      dialect: artifact.dialect,
      vocabulary: artifact.vocabulary,
      engineName: artifact.name,
      classes: 're-extracted',
      reason,
      rulesLoaded,
      rulesSkipped: !sameDialect && declaresRules,
      lost: providerLost,
      gained: providerGained,
    })
    resolverInputs.push(withReextractedClasses(input, reextracted, engine))
  }

  return {
    inputs: resolverInputs,
    decisions,
    contribution: { rules, variants, preflights, sources },
    lost: [...lost].sort(),
  }
}

async function importEngineModule(module: string, baseUrl: string): Promise<EngineModuleShape> {
  const loaded = await import(new URL(module, baseUrl).href) as { default?: EngineModuleShape }
  return loaded.default ?? (loaded as EngineModuleShape)
}

/**
 * Классы каждого компонента заново: кандидаты экстрактором движка приложения из
 * `files` манифеста, затем один `generate` на пакет — только имена с правилом
 * остаются (тот же порядок, что у сборки провайдера, B-6).
 */
async function reextractProvider(
  loaded: GranumLoadedManifest,
  engine: GranumEngine,
  contribution: Pick<EngineInput, 'rules' | 'variants'>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const key = `${loaded.manifest.hash}|${engine.vocabulary}|${contribution.rules?.length ?? 0}:${contribution.variants?.length ?? 0}`
  const cached = reextractCache.get(key)
  if (cached)
    return cached

  const baseDir = fileURLToPath(loaded.baseUrl)
  const perComponent = new Map<string, Set<string>>()
  const all = new Set<string>()
  for (const [name, component] of Object.entries(loaded.manifest.components)) {
    const candidates = new Set<string>()
    for (const file of component.files) {
      let code: string
      try {
        code = readFileSync(join(baseDir, file), 'utf8')
      }
      catch {
        continue
      }
      for (const token of engine.extract(code, file)) {
        candidates.add(token)
        all.add(token)
      }
    }
    perComponent.set(name, candidates)
  }

  const generated = await engine.generate({
    classes: all,
    ...(contribution.rules?.length ? { rules: contribution.rules } : {}),
    ...(contribution.variants?.length ? { variants: contribution.variants } : {}),
  })
  const out = new Map<string, readonly string[]>()
  for (const [name, candidates] of perComponent)
    out.set(name, sortedUnique([...candidates].filter(c => generated.matched.has(c))))
  reextractCache.set(key, out)
  return out
}

/**
 * Манифест с пересчитанными классами: движок в блоке `engine` — уже движок
 * приложения, потому что именно он отфильтровал список. Хеш пересчитывается,
 * чтобы структура осталась согласованной; файл на диске не меняется.
 */
function withReextractedClasses(
  loaded: GranumLoadedManifest,
  classes: ReadonlyMap<string, readonly string[]>,
  engine: GranumEngine,
): GranumLoadedManifest {
  const components: Record<string, GranumManifest['components'][string]> = {}
  for (const [name, component] of Object.entries(loaded.manifest.components))
    components[name] = { ...component, classes: classes.get(name) ?? component.classes }
  const body: GranumManifest = {
    ...loaded.manifest,
    generatedBy: `${loaded.manifest.generatedBy} (classes re-extracted by ${engine.name})`,
    engine: {
      ...loaded.manifest.engine,
      dialect: engine.dialect,
      vocabulary: engine.vocabulary,
      name: engine.name,
      ...(engine.version !== undefined ? { version: engine.version } : {}),
    },
    components,
    hash: '',
  }
  return { manifest: { ...body, hash: computeManifestHash(body) }, baseUrl: loaded.baseUrl }
}
