#!/usr/bin/env node
/**
 * Сервер стенда: dev с middleware Vite и prod поверх собранных `dist/client` и
 * `dist/server`.
 *
 *   node server.mjs           # dev, трансформация на лету
 *   node server.mjs --prod    # по собранному дистрибутиву
 *
 * Стенд проверяется не этим сервером, а `scripts/verify-ssr.mjs`: он берёт тот
 * же серверный бандл и те же ассеты. Сервер нужен, чтобы стенд можно было
 * открыть руками.
 */
import { createServer as createHttpServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('./', import.meta.url))
const prod = process.argv.includes('--prod')
const port = Number(process.env.PORT ?? 5180)

const { render, ROOT_TAG } = prod
  ? await import(join(root, 'dist/server/entry-server.js'))
  : { render: null, ROOT_TAG: null }

const vite = prod
  ? null
  : await (await import('vite')).createServer({ root, server: { middlewareMode: true }, appType: 'custom' })

const template = prod
  ? readFileSync(join(root, 'dist/client/index.html'), 'utf8')
  : null

async function handle(req, res) {
  const url = req.url ?? '/'
  try {
    let html
    if (prod) {
      const result = await render(url)
      html = template
        .replace(ROOT_TAG, result.rootTag)
        .replace('<!--app-html-->', result.html)
    }
    else {
      const module = await vite.ssrLoadModule('/src/entry-server.ts')
      const result = await module.render(url)
      const shell = await vite.transformIndexHtml(url, readFileSync(join(root, 'index.html'), 'utf8'))
      html = shell
        .replace(module.ROOT_TAG, result.rootTag)
        .replace('<!--app-html-->', result.html)
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  }
  catch (error) {
    vite?.ssrFixStacktrace(error)
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(String(error?.stack ?? error))
  }
}

const server = createHttpServer((req, res) => {
  if (vite)
    vite.middlewares(req, res, () => handle(req, res))
  else
    handle(req, res)
})

server.listen(port, () => {
  process.stdout.write(`app-ssr: http://localhost:${port}/?theme=dark  (${prod ? 'prod' : 'dev'})\n`)
})
