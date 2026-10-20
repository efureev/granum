/**
 * CSS темы провайдера без приложения и без движка утилит: слои `tokens`,
 * `base` и `themes` по тем же правилам эмиссии, что у сборки приложения
 * (T-8…T-13). Для подключения дизайн-системы без granum —
 * `@scope/ds/themes/<id>.css`: провайдер собирает его из своих компонентов и
 * каталога владельца тем, не подделывая манифест.
 */
import type { GranumCssOptions } from '../config'
import type { GranumProviderInput } from '../contract'
import type { GranumResolution } from '../core/resolve'
import type { GranumModesInput, GranumThemeChoice } from '../core/resolveThemes'
import type { LayerName } from './emit'
import { isLoadedManifest } from '../contract/manifest'
import { CssReadError } from '../core/errors'
import { toProviderNode } from '../core/providerNode'
import { resolveGranum } from '../core/resolve'
import { planThemes } from '../core/resolveThemes'
import { readCss } from './css'
import { wrapLayers } from './emit'
import { resolveInlinedCssSources } from './inlinedCss'
import { loadProviderInputs, materializeAppModes, readComponentThemes, readPlannedThemeData } from './prepare'
import { emitThemeCss } from './themeCss'

export interface ThemeStylesheetOptions {
  /** Имена пакетов (манифест через `exports`), объекты контракта или прочитанные манифесты. */
  readonly providers: readonly (string | GranumProviderInput)[]
  readonly theme?: GranumThemeChoice
  readonly previews?: readonly GranumThemeChoice[]
  readonly modes?: GranumModesInput
  /** Каталог, от которого разрешаются пакеты провайдеров. */
  readonly root: string
  readonly css?: Pick<GranumCssOptions, 'layers' | 'layerPrefix'>
}

export interface ThemeStylesheet {
  /** Слои `tokens`, `base`, `themes` в обёртках `@layer` (или плоско при `css.layers: false`). */
  readonly css: string
  readonly layers: Readonly<Record<'tokens' | 'base' | 'themes', string>>
  /** Слои `tokens` и `themes` по частям — для раздачи темы файлом на режим. */
  readonly parts: ThemeStylesheetParts
  readonly resolution: GranumResolution
}

/**
 * Тема по частям, плоско (T-16). Приложение подключает `root` и нужные режимы —
 * `root` первым: фолбэки режима перекрывают формулы `root` при равной
 * специфичности. Каждый режим самодостаточен: его блок несёт значения целиком,
 * с унаследованными по `extends`, и обходится без файла базы. `:root` — только
 * у режима по умолчанию. Слой `base` в части не входит — он в `layers.base`.
 */
export interface ThemeStylesheetParts {
  /** Всё, что от режима не зависит: слой `tokens`, затем общий блок слоя `themes`. */
  readonly root: string
  /** По режиму сборки, в порядке режимов: блок пары, фолбэки `@supports`, медиазапрос системной схемы. */
  readonly modes: Readonly<Record<string, string>>
  /** По теме превью: её пары целиком (A-32). */
  readonly previews: Readonly<Record<string, string>>
}

export type ThemeResolutionOptions = Omit<ThemeStylesheetOptions, 'css'>

/**
 * Резолюция только тем — без скана приложения и без движка. Объектные
 * провайдеры не сканируются: классы и CSS компонентов теме не нужны, а токены
 * `themesDir` читаются по `sourceUrl` дескриптора. Токены компонентов — всех
 * компонентов провайдеров, кроме доноров, подгруженных по зависимости.
 */
export function resolveThemeOnly(options: ThemeResolutionOptions): GranumResolution {
  const donors = new Set<string>()
  const inputs = loadProviderInputs({ providers: options.providers }, options.root, donors)
  const nodes = inputs.map(toProviderNode)
  const choice = {
    ...(options.theme !== undefined ? { theme: options.theme } : {}),
    ...(options.previews !== undefined ? { previews: options.previews } : {}),
  }
  const plan = planThemes(nodes, choice)
  const modes = materializeAppModes(options.modes, options.root)
  return resolveGranum({
    providers: inputs,
    components: nodes.filter(node => !donors.has(node.id)).map(node => ({ provider: node.id, names: 'all' as const })),
    ...choice,
    ...(modes !== undefined ? { modes } : {}),
    themeData: readPlannedThemeData([plan.active, ...plan.previews], nodes),
    componentThemes: readComponentThemes(inputs.filter(input => !isLoadedManifest(input))),
  })
}

export async function emitThemeStylesheet(options: ThemeStylesheetOptions): Promise<ThemeStylesheet> {
  const resolution = resolveThemeOnly(options)

  const sections = await Promise.all(resolveInlinedCssSources(resolution).map(async (source) => {
    try {
      return { kind: source.kind, css: await readCss(source.path) }
    }
    catch (cause) {
      throw new CssReadError(source.providerId, source.kind, source.kind, source.path, { cause })
    }
  }))
  const theme = emitThemeCss(resolution)
  const layers = {
    tokens: [...sections.filter(s => s.kind === 'tokens').map(s => s.css), ...(theme.tokens !== undefined ? [theme.tokens] : [])].join('\n'),
    base: [...sections.filter(s => s.kind === 'base').map(s => s.css), ...theme.base].join('\n'),
    themes: theme.themes.join('\n'),
  }
  const all: Record<LayerName, string> = { ...layers, components: '', utilities: '' }
  const parts: ThemeStylesheetParts = {
    root: [layers.tokens, ...theme.parts.shared].filter(Boolean).join('\n'),
    modes: Object.fromEntries(theme.parts.modes.map(part => [part.name, part.blocks.join('\n')])),
    previews: Object.fromEntries(theme.parts.previews.map(part => [part.id, part.blocks.join('\n')])),
  }
  return { css: wrapLayers(all, options.css ?? {}), layers, parts, resolution }
}
