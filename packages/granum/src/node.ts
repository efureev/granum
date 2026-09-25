/**
 * Точка входа `./node`: манифесты, эмиссия CSS, диагностика как функции
 * (ТЗ §7, §12). Node-only, без внешних зависимостей. Эмиссия и диагностика —
 * этапы 5–6.
 */
export * from './index'
export {
  canonicalizeManifest,
  computeManifestHash,
  isPackageRelativePath,
  loadPackageManifest,
  locateManifest,
  MANIFEST_FILE_NAME,
  parseManifest,
  readManifestSync,
  serializeManifest,
  writeManifestSync,
} from './node/manifest'
