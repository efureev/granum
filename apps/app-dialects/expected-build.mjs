/**
 * Ожидаемая РАБОТА сборки app-dialects. Проверяется `node scripts/report-build-time.mjs --strict`
 * из каталога стенда (`yarn time:check`).
 *
 * Стенд намеренно стоит на дорогом пути: диалект пакета не совпадает с движком
 * приложения, поэтому классы пересчитываются по файлам пакета. Здесь это
 * ожидаемо и записано явно — а на `bench-one` ожидается обратное. Пара стендов
 * и сторожит границу: пересчёт не должен ни исчезнуть здесь, ни появиться там.
 */
export default {
  purpose: 'работа сборки: пересчёт классов из-за чужого диалекта',
  work: {
    providers: 1,
    reextract: ['dialect'],
    classSources: ['re-extracted'],
    classesInput: 34,
    classesMatched: 1,
    selection: 1,
  },
  time: { maxGranumShare: 0.35 },
  hints: { wallMs: 600, granumMs: 48 },
}
