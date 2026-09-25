import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** @param {{ manifest: import('@feugene/granum').GranumManifest, distDir: string, check: (c: boolean, m: string) => void }} ctx */
export default function ({ manifest, distDir, check }) {
  const c = manifest.components
  check(manifest.id === '@granum-fixtures/simple', 'id')
  check(Object.keys(c).join(',') === 'XGroupAOne,XGroupATwo,XNested,XNestedReverse,XTest1,XTestStyled,XTokenized', `components: ${Object.keys(c)}`)

  // Статические классы из шаблонов, включая части и общий SFC группы (INV-MAN-5).
  check(c.XTest1.classes.join(' ') === 'border border-[var(--brd)] p-4', `XTest1.classes: ${c.XTest1.classes}`)
  check(c.XNested.classes.includes('text-7xl') && c.XNested.classes.includes('uppercase') && c.XNested.classes.includes('rounded-3xl'), `XNested.classes: ${c.XNested.classes}`)
  check(c.XGroupAOne.classes.includes('text-9xl') && c.XGroupAOne.classes.includes('border-dashed'), `XGroupAOne.classes: ${c.XGroupAOne.classes}`)
  check(c.XGroupATwo.classes.includes('text-9xl') && c.XGroupATwo.classes.includes('border-dotted'), `XGroupATwo.classes: ${c.XGroupATwo.classes}`)
  check(c.XGroupAOne.group === 'groupA' && c.XGroupAOne.files.some(f => f.startsWith('groups/groupA/shared/')), `XGroupAOne.files: ${c.XGroupAOne.files}`)
  check(c.XNestedReverse.classes.includes('border-red') && c.XNestedReverse.classes.includes('tracking-widest'), `XNestedReverse.classes: ${c.XNestedReverse.classes}`)

  // Строка `base` уезжает в чанк литералом целиком, поэтому её классы видны и
  // статике: safelist тут избыточен, и сборка честно это говорит (INV-MAN-4).
  check(c.XTestStyled.safelist.includes('rounded-[var(--ds-radius-lg)]') && c.XTestStyled.classes.includes('shadow-sm'), `XTestStyled: ${c.XTestStyled.classes} / ${c.XTestStyled.safelist}`)
  check(manifest.warnings.some(w => w.code === 'safelist-redundant' && w.component === 'XTestStyled'), `warnings: ${JSON.stringify(manifest.warnings)}`)
  check(c.XTokenized.classes.includes('space-y-2xl') && c.XTokenized.classes.includes('border-green'), `XTokenized.classes: ${c.XTokenized.classes}`)

  // Ссылки на токены материализованы (C-13); обе формы.
  check(c.XTokenized.tokens.declares.light?.tokens['x-tokenized'] === 'red', 'XTokenized light tokens')
  check(c.XTokenized.tokens.declares.dark?.selector === '.dark, [data-theme="dark"]', 'XTokenized dark selector')
  check(c.XTokenized.tokens.consumes.includes('--x-tokenized'), `XTokenized.consumes: ${c.XTokenized.tokens.consumes}`)
  check(c.XTest1.tokens.consumes.includes('--brd'), `XTest1.consumes: ${c.XTest1.tokens.consumes}`)

  // CSS компонента: стиль SFC эмитирован в контрактный путь, @apply раскрыт (B-3, B-11).
  check(c.XTest1.css.includes('components/XTest1/styles.css'), `XTest1.css: ${c.XTest1.css}`)
  const css = readFileSync(join(distDir, 'components/XTest1/styles.css'), 'utf8')
  check(!/@apply\s/.test(css) && css.includes('font-weight:700') && css.includes('font-size:1.125rem') && css.includes('color:rgb(239 68 68'), `XTest1 styles.css: ${css}`)

  // Раскладка (INV-LAY-1).
  for (const name of Object.keys(c))
    check(existsSync(join(distDir, 'components', name, 'index.js')), `entry ${name}`)
  check(manifest.warnings.length === 1, `warnings: ${JSON.stringify(manifest.warnings)}`)
}
