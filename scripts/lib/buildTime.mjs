/**
 * Чистые функции замера времени сборки (пункт 2.3 роадмапа). Ни одного
 * обращения к FS и ни одного запуска процесса: ввод — текст и данные, вывод —
 * данные. I/O, прогоны и печать живут в `report-build-time.mjs`.
 *
 * Почему гейт не на секундах. Бюджет CSS уже отказался от порога на байты:
 * gzip невоспроизводим между средами, а порог с потолка краснеет на честном
 * росте. Со временем это верно вдвойне — оно зависит от машины, нагрузки и
 * версии Node. Поэтому секунды печатаются как ориентир, а гейтится РАБОТА:
 * пересчитывал ли granum классы пакетов, сколько классов прошло через
 * генератор, сколько компонентов в селекции. Регрессия времени почти всегда
 * начинается с регрессии работы, и она-то воспроизводима.
 */

/** Медиана: устойчивее среднего к одному выбросу, а выбросы в замерах — норма. */
export function median(values) {
  if (values.length === 0)
    return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** Разброс замеров в долях медианы: печатается рядом с числами как мера доверия к ним. */
export function spread(values) {
  const m = median(values)
  if (m === 0 || values.length === 0)
    return 0
  return (Math.max(...values) - Math.min(...values)) / m
}

/**
 * Строка фаз из лога сборки: `[granum] time 76 ms (prepare 3, emit 35, report 38)`.
 *
 * Её печатает сам плагин, и другого источника этих чисел нет: в
 * `granum-report.json` время не попадает — отчёт обязан быть побайтно
 * стабильным между сборками (INV-DET-2).
 */
export function parseGranumTime(stdout) {
  const m = /\[granum\] time (\d+) ms \(prepare (\d+), emit (\d+), report (\d+)\)/.exec(stdout)
  if (!m)
    return null
  return { total: Number(m[1]), prepare: Number(m[2]), emit: Number(m[3]), report: Number(m[4]) }
}

/**
 * Факты о проделанной работе — то, что гейтится. Берутся из отчёта сборки, а
 * не из замера, поэтому воспроизводимы на любой машине.
 *
 * `reextract` — самый дорогой путь granum: отпечаток словаря пакета разошёлся с
 * движком приложения, и классы пересчитываются по файлам пакета. На восьми
 * провайдерах это секунда, и если он включится там, где раньше был `none`, —
 * время сборки вырастет молча.
 */
export function workFacts(report) {
  return {
    providers: report.providers.length,
    reextract: [...new Set(report.providers.map(p => p.reason))].sort(),
    classSources: [...new Set(report.providers.map(p => p.classes))].sort(),
    classesInput: report.classes.input,
    classesMatched: report.classes.matched,
    selection: report.selection.length,
  }
}

/** Сверка ожиданий `expected-build.mjs` с замером — в обе стороны, как в бюджете CSS. */
export function strictBuildCheck(expected, report) {
  const checks = []
  const push = (name, ok, actual, want) => checks.push({ name, ok, actual, want })
  const same = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort())

  for (const [key, want] of Object.entries(expected.work ?? {})) {
    const actual = report.work[key]
    if (want === undefined)
      continue
    push(`work.${key}`, Array.isArray(want) ? same(want, actual ?? []) : actual === want, actual, want)
  }

  /*
   * Единственная проверка, где участвует время, и та относительная: доля
   * granum во всей сборке стенда. Абсолютные миллисекунды зависят от машины,
   * доля — гораздо меньше, а катастрофа (генератор побежал по кругу, пересчёт
   * включился на каждую сборку) выносит её далеко за любой разумный потолок.
   */
  if (expected.time?.maxGranumShare !== undefined) {
    const share = report.time.granumShare
    push('time.maxGranumShare', share <= expected.time.maxGranumShare, share.toFixed(2), `<= ${expected.time.maxGranumShare}`)
  }
  return checks
}
