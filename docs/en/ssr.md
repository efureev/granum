# Server-side rendering

> 🇷🇺 Русская версия: [`../ru/ssr.md`](../ru/ssr.md).

granum asks nothing special of SSR, but two things need a deliberate decision:
where the CSS comes from and who picks the mode. Both are decided once and then
stay out of the way. A complete working example is the
[`apps/app-ssr`](../../apps/app-ssr) stand.

## CSS: no per-module collection

The whole application CSS is a single asset with five cascade layers, referenced
by the template. The usual SSR chore of collecting the styles of the rendered
modules and injecting them into the response is therefore unnecessary: there is
nothing to collect, and the link is already in the template.

The server entry does not import `virtual:granum.css` at all — only the client
one does:

```ts
// src/entry-client.ts
import 'virtual:granum.css'
```

```ts
// src/entry-server.ts — imports no styles
import { renderToString } from '@vue/server-renderer'
```

The same reasoning settles `--ssrManifest`: it is needed when the CSS is split by
route and each response needs its own set of links. With granum there is one set.

## The server picks the mode

The theme is chosen at build time, and the values of all its modes are already in CSS.
Switching a mode is a pair in the root attribute: `data-theme="slate-dark"`. Only
the build knows the pair values, and they reach the runtime as a manifest:

```ts
import manifest from 'virtual:granum/themes'

manifest.modes
// [{ name: 'light', colorScheme: 'light', value: 'slate-light' },
//  { name: 'dark',  colorScheme: 'dark',  value: 'slate-dark' }]
```

If the browser picks the mode after hydration, the first frame is always wrong: the
server sent one mode, the client immediately switched to another. So the decision is
made on the server and written into the opening tag of the document — as a pair, for the
default mode too: the client reads it back.

```ts
// src/entry-server.ts
import { modeFromCookie, themeRootAttributes } from '@feugene/granum/runtime'

const mode = modeFromCookie(manifest, request.headers.cookie)?.name ?? manifest.defaultMode
const attrs = themeRootAttributes(manifest, mode)   // { 'data-theme': 'slate-dark' }
```

The user's choice reaches the server in a cookie: on the client it is written by
`createCookieStorage()`, the server reads it with `modeFromCookie`. A name that is not
among the build's modes is never returned by `modeFromCookie`: no CSS blocks were emitted
for it. Serve the default mode rather than a page without tokens.

## Without a server: a script before the first frame

For a static application the pair is set by an inline script in `<head>` — before the
browser paints the first frame. The script leaves a pair set by the server alone; otherwise
it takes the mode from a cookie (if its name is given), from `localStorage`, by the system
scheme and, finally, the default mode.

```ts
import { createThemeScript } from '@feugene/granum/runtime'

const script = createThemeScript({ manifest, nonce, cookie: 'granum-theme' })
// '<script nonce="…">(function(){…})()</script>' — into the template's <head>
```

The plugin inserts it itself with `granum(config, { themeScript: true })` — first in the
`<head>` of the HTML entry. An SSR application inserts the string itself or does with
the pair the server writes.

## The client reads the mode instead of picking it

```ts
// src/entry-client.ts
const controller = createThemeController(manifest, { storage: createCookieStorage() })
```

A controller raised over a pair that is already set recognises the mode by it and leaves
the root alone, so the first client frame matches the server one. It stores the mode
name, not the pair: changing the theme at build time does not reset the user's choice. There
is no need to read the choice from `localStorage` behind the server's back: if the server
sent one mode and the client switched to another, that is exactly the flash SSR avoids.

## The markup does not depend on the source of the mode

The controller is a browser thing. For the markup to come out the same on both
sides, components must not know about it: they need the name of the active mode and a way
to change it.

```ts
export interface ActiveMode {
  readonly name: string
  readonly list: readonly string[]
  readonly set: (name: string) => void
}
```

On the server `set` is a no-op, in the browser it calls the controller's `setMode`.
The application passes this pair through its own dependency injection, and the
markup comes out the same on both sides.

## The runtime under Node

The `@feugene/granum/runtime` entry is declared browser-only: no `node:` imports
and no external dependencies. "Browser-only" does not mean "crashes on the server":
without a DOM the controller is constructed, answers questions about the modes and the
current mode and simply does not apply it. That lets the server use it to validate a mode name.

## granum on the server

Vite's server build keeps packages from `node_modules` external: the server
loads their `dist` at runtime. A provider built by `granumProvider` does not
import granum then — the contract helpers are embedded in its `dist` — so granum
can stay in `devDependencies`, and a deploy with `--omit=dev` works. The
exception is the application's own server code: if it imports
`@feugene/granum/runtime` (the mode controller, as the stand does), granum
belongs in `dependencies` or in `ssr.noExternal`. A provider built by granum
before 2.0 pulls `@feugene/granum/contract` at runtime — rebuilding it is enough.

## What to check in your own application

The `apps/app-ssr` stand checks this with a script that imports the built server
bundle and renders with it. The minimum set for your own application:

1. the same request produces the same markup;
2. the mode pair is visible on the root, and reading it back returns the same mode;
3. starting the controller does not change the root, while switching does;
4. an unknown mode name falls back to the default one, a cookie picks the mode;
5. there is exactly one CSS asset and the template references it;
6. providers from `node_modules` load without granum, as after `--omit=dev`.
