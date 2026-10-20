/**
 * Листы, которые подключает HTML-страница сборки: имена ассетов из
 * `<link rel="stylesheet" href="…/assets/<имя>">` в порядке подключения. Нужны
 * стенду, где разные страницы обязаны получать разный CSS — склейка всех
 * ассетов этого не различит.
 */
export function pageStylesheets(html) {
  const out = []
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    if (!/\brel=["']?stylesheet\b/.test(tag))
      continue
    const href = /\bhref=["']([^"']+)["']/.exec(tag)?.[1]
    if (href)
      out.push(href.slice(href.lastIndexOf('/') + 1))
  }
  return out
}
