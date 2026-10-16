// Тест разметки: регэксп и строки — код, а не атрибут `class`.
export function check(source: string): boolean {
  return /class="max-w-full px-4 leading-6/.test(source) && source.includes('tabindex="0"')
}
