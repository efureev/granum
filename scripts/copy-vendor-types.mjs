#!/usr/bin/env node
/**
 * После `tsc` копирует `.d.ts` вендоренного ядра в `dist/types`: tsc не эмитит
 * декларации для входных `.d.ts`, а внутренние модули движка на них ссылаются.
 * Запускается из каталога пакета, который вендорит код
 * (`packages/granum-engine-wind`, скрипт `build`).
 */
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const pkg = process.cwd()
const rel = process.argv[2] ?? 'src/vendor'
const from = join(pkg, rel)
const to = join(pkg, 'dist/types', rel)
if (!existsSync(from)) {
  console.error(`copy-vendor-types: нет ${rel} — запусти yarn vendor:unocss`)
  process.exit(1)
}
cpSync(from, to, { recursive: true, filter: src => !/\.js$/.test(src) })
console.log(`copy-vendor-types: ok (${rel})`)
