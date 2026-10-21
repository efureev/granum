#!/usr/bin/env node
/** Сверка собранного пакета темы: тема-объект с живым наследованием, версией и целевыми пакетами. */
import assert from 'node:assert/strict'
import theme from './dist/index.js'

assert.equal(theme.id, 'tide')
assert.equal(theme.version, '2.1.0')
assert.equal(theme.extends, 'stone', 'наследование не раскрыто: его раскрывает приложение')
assert.deepEqual(theme.targets, { '@granum-fixtures/valued-ds': '^1.0.0' })
assert.deepEqual(Object.keys(theme.modes), ['light', 'dark'])
assert.equal(theme.modes.light.tokens['vd-accent'], '#0e7490')
assert.equal(theme.components['@granum-fixtures/valued-ds'].VdCard.modes.light['vd-card-bg'], '#ecfeff')
assert.equal(theme.sources, undefined, 'пути машины в пакет не едут')
console.log('verify: @granum-fixtures/theme-tide — ok')
