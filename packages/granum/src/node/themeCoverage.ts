/**
 * Полнота тем сборки: каждый обязательный токен темы получает значение в каждом
 * её режиме. Реестр владельца сборка провайдера проверяет у тем каталога, но
 * требования компонентов в ту проверку не входят, а тему-объект приложения и
 * объектного провайдера не проверяет никто: `token-undefined` считается по
 * объединению тем, и токен, которого нет у одной из них, не находка.
 *
 * Обязательные токены:
 *   - токены реестра владельца каталога — тем же правилом, что на сборке
 *     провайдера: `root` — в корне темы, `mode` — в каждом её режиме;
 *   - требования компонентов селекции, которые задаёт хоть одна тема сборки, —
 *     в каждом режиме: под каким селектором компонент читает токен, манифест не
 *     знает, а пара режима без значения его не получит. Значение во фолбэке
 *     `@supports` режима этот режим покрывает. Объявленное инлайнимыми файлами
 *     провайдеров общее для всех тем и не требуется.
 *
 * Требование, которого не задаёт никто, — дело `token-undefined`: оно уходит из
 * обязательных, даже если оно есть в реестре, — одна дыра, одна находка. У темы
 * без режимов нет пар, и всё, что у неё есть, — корень: там токен и ищется.
 */
import type { GranumResolution } from '../core/resolve'
import type { TokenNature } from '../core/themeData'
import type { ThemeTokenSet } from '../core/tokenLayers'
import type { TokenDeclarations } from './undefinedTokens'
import { tokenValueIn } from '../core/tokenLayers'
import { componentRequirements, findUndefinedTokens, tokenDeclarations } from './undefinedTokens'

export interface ThemeCoverage {
  readonly theme: string
  /** Обязательных токенов темы. */
  readonly required: number
  /** Из них со значением во всех нужных режимах. */
  readonly covered: number
  /** Непокрытое: `root:<токен>` у токена реестра `root` и у темы без режимов, иначе `<режим>:<токен>`; токены без `--`. */
  readonly missing: readonly string[]
}

/** Природа обязательного токена: из реестра или требование компонента. */
type Requirement = TokenNature | 'requires'

/** Значение требования в режиме: режимное, корневое — или во фолбэке этого режима. */
function requirementIn(set: ThemeTokenSet | undefined, mode: string, token: string): boolean {
  if (tokenValueIn(set, mode, token) !== undefined)
    return true
  return (set?.fallbacks.get(mode) ?? []).some(block => block.tokens.get(token)?.effective !== undefined)
}

/** По кодовым единицам, как `.sort()` у соседних вердиктов: порядок не зависит от локали машины. */
function byCodeUnits([a]: readonly [string, Requirement], [b]: readonly [string, Requirement]): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function themeCoverage(
  resolution: GranumResolution,
  registry: Readonly<Record<string, TokenNature>> | undefined,
  declarations: TokenDeclarations = tokenDeclarations(resolution),
): ThemeCoverage[] {
  const undefinedTokens = new Set(findUndefinedTokens(resolution, declarations).map(u => u.token.slice(2)))
  const required = new Map<string, Requirement>()
  for (const [token, nature] of Object.entries(registry ?? {})) {
    if (!undefinedTokens.has(token))
      required.set(token, nature)
  }
  for (const { component } of resolution.selection.entries) {
    for (const token of componentRequirements(component)) {
      const name = token.slice(2)
      if (!declarations.inlined.has(token) && declarations.themes.has(name) && !required.has(name))
        required.set(name, 'requires')
    }
  }
  const tokens = [...required].sort(byCodeUnits)

  return resolution.themes.themes.map((entry, i) => {
    const set = resolution.tokens.themes[i]
    const modes = entry.modes.map(mode => mode.name)
    const missing: string[] = []
    let covered = 0
    for (const [token, nature] of tokens) {
      if (nature === 'root' || modes.length === 0) {
        if (set?.root.get(token)?.effective !== undefined)
          covered++
        else
          missing.push(`root:${token}`)
        continue
      }
      const gaps = modes.filter(mode => nature === 'mode' ? tokenValueIn(set, mode, token) === undefined : !requirementIn(set, mode, token))
      if (gaps.length === 0)
        covered++
      else
        missing.push(...gaps.map(mode => `${mode}:${token}`))
    }
    return { theme: entry.theme.id, required: tokens.length, covered, missing }
  })
}
