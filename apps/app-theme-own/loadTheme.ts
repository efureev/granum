import type { GranumAppTheme } from '@feugene/granum'
import type { GranumThemeData } from '@feugene/granum/contract'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const json = (file: string): any => JSON.parse(readFileSync(file, 'utf8'))

/**
 * Тема приложения из папки: `theme.json` (id, title, extends), `root.json`,
 * `modes/<режим>.json` — только отличия. Наследование темы разрешает
 * приложение до конфига: granum получает полные данные, а `extends`
 * оставляет ему цепочку для токенов компонентов.
 */
export function loadTheme(dirUrl: URL): GranumAppTheme {
  const dir = fileURLToPath(dirUrl)
  const meta = json(join(dir, 'theme.json'))
  const require = createRequire(import.meta.url)
  const base: GranumThemeData = json(require.resolve(`@granum-fixtures/themes/themes/${meta.extends}.json`))
  const own = (name: string): Record<string, string> => {
    const file = join(dir, 'modes', `${name}.json`)
    return existsSync(file) ? json(file) : {}
  }
  const ownModes = readdirSync(join(dir, 'modes')).map(file => file.replace(/\.json$/, ''))
  const modes = Object.fromEntries([...new Set([...Object.keys(base.modes), ...ownModes])].map(name => [name, {
    ...base.modes[name],
    colorScheme: base.modes[name]?.colorScheme ?? 'light',
    tokens: { ...base.modes[name]?.tokens, ...own(name) },
  }]))
  return {
    ...base,
    id: meta.id,
    title: meta.title,
    root: { ...base.root, ...json(join(dir, 'root.json')) },
    modes,
    extends: meta.extends,
    sources: [dir],
  }
}
