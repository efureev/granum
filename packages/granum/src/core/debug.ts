/**
 * Минимальный `debug`-совместимый логгер по переменной окружения `DEBUG`.
 * Namespace ядра — `granum:resolve`. Browser-safe: без `process` логирование
 * выключено; импорт из `node:process` здесь запрещён (INV-BND-1).
 */

function debugPatterns(): string[] {
  // eslint-disable-next-line node/prefer-global/process
  const env = (typeof process !== 'undefined' && process.env && process.env.DEBUG) || ''
  return env ? env.split(/[\s,]+/).filter(Boolean) : []
}

function matches(pattern: string, namespace: string): boolean {
  if (pattern === '*')
    return true
  if (pattern.endsWith('*'))
    return namespace.startsWith(pattern.slice(0, -1))
  return pattern === namespace
}

/** Читает `DEBUG` на каждый вызов. */
export function isDebugEnabled(namespace: string): boolean {
  return debugPatterns().some(pattern => matches(pattern, namespace))
}

/**
 * Создаёт логгер; `DEBUG` разбирается один раз при создании, выключенный
 * логгер — no-op без аллокаций.
 */
export function createDebug(namespace: string): (message: string) => void {
  if (!isDebugEnabled(namespace))
    return () => {}
  return (message: string): void => {
    console.error(`  ${namespace} ${message}`)
  }
}
