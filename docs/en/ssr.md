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

The themes are chosen at build time: the default theme's values are in the shared
sheet, the additional themes' — in their sheets. Switching a theme and a mode is a pair
in the root attribute: `data-theme="slate-dark"`. Only the build knows the pair values
and the sheet addresses, and they reach the runtime as a manifest:

```ts
import manifest from 'virtual:granum/themes'

manifest.defaultTheme // 'slate'
manifest.themes[0].modes
// [{ name: 'light', colorScheme: 'light', value: 'slate-light' },
//  { name: 'dark',  colorScheme: 'dark',  value: 'slate-dark' }]
```

If the browser picks the mode after hydration, the first frame is always wrong: the
server sent one mode, the client immediately switched to another. So when the server
knows the user's choice, it writes the pair into the opening tag of the document, and
the client reads it back.

```ts
// src/entry-server.ts
import { themeFromCookie, themeRootAttributes, themeSheetLink } from '@feugene/granum/runtime'

const chosen = themeFromCookie(manifest, request.headers.cookie)
const attrs = chosen ? themeRootAttributes(manifest, { theme: chosen.theme.id, mode: chosen.mode.name }) : {} // { 'data-theme': 'slate-dark' }
const link = chosen && themeSheetLink(manifest, chosen.theme.id) // the <link> of an additional theme's sheet; undefined for the default one
```

The user's choice reaches the server in a cookie: on the client it is written by
`createCookieStorage()`, the server reads it with `themeFromCookie`. A key that names
no mode of a selectable build theme is never returned by `themeFromCookie`: there are no
CSS blocks for it. For an additional theme the server also puts its sheet's `<link>`
into `<head>` — its order against the shared sheet does not matter, the cascade does
not depend on it. An application framed by another site needs `sameSite: 'none'` — the storage writes
such a cookie with `Secure`, without which the browser rejects it; `secure: true` adds the
attribute with other values too.

Without the cookie the server does not know the choice — it may live in `localStorage`
or follow the system scheme. Leave the root without a pair and put the script from the
next section into `<head>`: it decides before the first frame. Do not set the default
mode's pair "just in case": the script leaves a pair from the server alone, and the
user's choice would be lost. Without the attribute the page still gets the default
mode — its block is under `:root`. The default pair is right only when the markup itself
depends on the mode and the choice is kept in the cookie alone, as in `apps/app-ssr`:
then no cookie means no choice.

## Without a server: a script before the first frame

For a static application the pair is set by an inline script in `<head>` — before the
browser paints the first frame. The script leaves a pair set by the server alone; otherwise
it takes the choice from a cookie (if its name is given), from `localStorage`, by the
default theme's system scheme and, finally, its default mode. For an additional theme it
first inserts its sheet's `<link rel="stylesheet" blocking="render">`, and it never picks a
theme without a sheet address: a pair without the sheet would give the default theme's values.

```ts
import { createThemeScript } from '@feugene/granum/runtime'

const script = createThemeScript({ manifest, nonce, cookie: 'granum-theme' })
// '<script nonce="…">(function f(){…})()</script>' — into the template's <head>
```

The code is built for the manifest: the pairs and the choice by scheme are constants, the
cookie branch exists only with `cookie`. Two modes with every option fit in about 500 bytes,
without the cookie — about 400. The script throws nothing: an error in `<head>` would leave
the page without a pair and with nobody to see it.

A host that swaps the document without a reload copies the root attributes from the new
document, where there is no pair. `reapplyOn` sets it again after the given `document` events:
`createThemeScript({ manifest, reapplyOn: ['astro:after-swap'] })`.

The plugin inserts it itself with `granum(config, { themeScript: true })` — first in the
`<head>` of the HTML entry. An SSR application inserts the string itself or does with
the pair the server writes.

A host that renders pages without an HTML entry (Astro, its own SSR server) needs the
manifest before Vite starts the build — `virtual:granum/themes` does not exist yet. The plugin
hands it over through its `api`, from the same config, so the script and the CSS cannot
disagree:

```ts
const plugin = config.vite.plugins.find(p => p?.name === 'granum:app')
const manifest = await plugin.api.themeManifest(projectRoot)
injectScript('head-inline', createThemeScriptCode({ manifest, storageKey: 'gr-theme', reapplyOn: ['astro:after-swap'] }))
```

`createThemeScriptCode` is the same code without the `<script>` tag.

Without the plugin — `resolveThemeManifest({ providers, themes, activation, root })` from
`@feugene/granum/node`: the same result, the app sources are not scanned.
Such a manifest has no sheet addresses — there are no assets yet — so the script will not
pick an additional theme; the server sets a root with its pair together with the `<link>`.

## The client reads the mode instead of picking it

```ts
// src/entry-client.ts
const controller = createThemeController(manifest, { storage: createCookieStorage() })
```

A controller raised over a pair that is already set recognises the mode by it and leaves
the root alone, so the first client frame matches the server one; it finds an additional
theme's sheet inserted by the server and does not duplicate it. It stores a selection key,
not the pair: for the default theme that is the mode name, so changing the default theme at
build time does not reset the user's choice. There
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
