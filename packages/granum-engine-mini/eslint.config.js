import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  gitignore: true,
  typescript: true,
  unocss: false,
  vue: false,
  jsonc: false,
  yaml: false,
  markdown: false,
  // Вендоренное ядро UnoCSS правится только патчами в scripts/vendor-unocss.mjs.
  ignores: ['src/vendor/**'],
}, {
  // Перенос unocss-mini-extra-rules: код держится близко к оригиналу ради
  // синхронизации, явные типы возврата там не требуются.
  files: ['src/rules/extra/**/*.ts'],
  rules: { 'ts/explicit-function-return-type': 'off' },
})
