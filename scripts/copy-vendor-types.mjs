#!/usr/bin/env node
/**
 * После `tsc` копирует `.d.ts` вендоренного ядра в `dist/types`: tsc не эмитит
 * декларации для входных `.d.ts`, а внутренние модули движка на них ссылаются.
 * Запускается из `packages/granum` (скрипт `build`).
 */
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const pkg = process.cwd()
const from = join(pkg, 'src/engine/vendor')
const to = join(pkg, 'dist/types/src/engine/vendor')
if (!existsSync(from)) {
  console.error('copy-vendor-types: нет src/engine/vendor — запусти yarn vendor:unocss')
  process.exit(1)
}
cpSync(from, to, { recursive: true, filter: src => !/\.js$/.test(src) })
console.log('copy-vendor-types: ok')
