import { describe, expect, it } from 'vitest'
import { collectImportSpecifiers, isRelative, stripComments } from '../lib/importSpecifiers.mjs'

describe('collectImportSpecifiers', () => {
  it('collects static, bare, dynamic and require specifiers', () => {
    const code = `
      import { a } from './a.js'
      import * as ns from "../ns.js"
      import 'side-effect'
      export { b } from 'node:fs'
      export * from './c.js'
      const d = await import('./d.js')
      const e = require('css-tree')
    `
    expect(collectImportSpecifiers(code)).toEqual([
      '../ns.js',
      './a.js',
      './c.js',
      './d.js',
      'css-tree',
      'node:fs',
      'side-effect',
    ])
  })

  it('ignores specifiers mentioned in comments', () => {
    const code = `
      /** import type { Rule } from '@unocss/core' */
      // import 'magic-string'
      const url = 'https://example.test/x' // import 'unocss'
      export const x = 1
    `
    expect(collectImportSpecifiers(code)).toEqual([])
  })

  it('keeps URLs with // inside strings', () => {
    expect(stripComments(`const u = 'https://a.b/c'`)).toBe(`const u = 'https://a.b/c'`)
  })

  it('isRelative', () => {
    expect(isRelative('./a.js')).toBe(true)
    expect(isRelative('../a.js')).toBe(true)
    expect(isRelative('vite')).toBe(false)
    expect(isRelative('node:fs')).toBe(false)
  })
})
