import { describe, expect, it } from 'vitest'
import { pageStylesheets } from '../lib/pageStylesheets.mjs'

describe('pageStylesheets', () => {
  it('листы страницы — имена ассетов из <link rel="stylesheet">, в порядке подключения', () => {
    const html = `<!doctype html><head>
      <link rel="icon" href="data:,">
      <script type="module" crossorigin src="/app/assets/index-a1.js"></script>
      <link rel="modulepreload" crossorigin href="/app/assets/shared-b2.js">
      <link rel="stylesheet" crossorigin href="/app/assets/shared-c3.css">
      <link crossorigin rel="stylesheet" href="/app/assets/previews-d4.css">
    </head>`
    expect(pageStylesheets(html)).toEqual(['shared-c3.css', 'previews-d4.css'])
  })

  it('страница без листов — пустой список', () => {
    expect(pageStylesheets('<!doctype html><body></body>')).toEqual([])
  })
})
