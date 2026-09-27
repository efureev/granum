# Server-side rendering

> 🇷🇺 Русская версия: [`../ru/ssr.md`](../ru/ssr.md).

granum asks nothing special of SSR, but two things need a deliberate decision:
where the CSS comes from and who picks the theme. Both are decided once and then
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

## The server picks the theme

The tokens of every theme are already in the CSS. Switching a theme means putting
the DOM into the state where the right block starts matching: an attribute, a
class, or nothing at all when the theme is emitted under `:root`. Which selector
belongs to which theme is known only to the build, and it reaches the runtime
through the manifest:

```ts
import manifest from 'virtual:granum/themes'

manifest.themes
// [{ name: 'light', activation: { type: 'root' } },
//  { name: 'dark',  activation: { type: 'attribute', name: 'data-theme', value: 'dark' } }]
```

When the browser picks the theme after hydration, the first frame is always the
wrong one: the server sent one theme and the client immediately switched to
another. So the decision is made on the server and written into the opening tag
of the document.

```ts
// src/entry-server.ts
function rootAttributes(manifest, name) {
  const { activation } = manifest.themes.find(theme => theme.name === name) ?? {}
  if (activation?.type === 'attribute')
    return ` ${activation.name}="${activation.value}"`
  if (activation?.type === 'class')
    return ` class="${activation.value}"`
  return ''
}
```

An empty string here is a legitimate result, not a failure: a theme with `root`
activation is active until another one is activated, and it has nothing to write
to the root.

The theme name from the request must be validated against the manifest. The CSS
only contains the themes listed in `themes.names` of the config; a name outside
that list means no token block was emitted for it, so there is nothing to
activate. Fall back to the default theme rather than serving a page without
tokens.

## The client reads the theme instead of picking it

The controller is created on top of the already applied state:

```ts
// src/entry-client.ts
const controller = createThemeController(manifest, {
  initial: readActiveTheme(manifest, document.documentElement),
})
```

`readActiveTheme` is the inverse of `rootAttributes`: it compares the activation
of every theme with what sits on the root. The controller starts with that theme
and leaves the root alone, so the first client frame matches the server one.

The user's stored choice from `localStorage` is deliberately not read at startup.
Reading it means the server sends one theme and the client switches to the stored
one — exactly the flash SSR exists to avoid. The choice has to reach the server
on its own: a cookie, a header, part of the address.

## The markup does not depend on the source of the theme

The controller is a browser thing. For the markup to come out identical on both
sides, components must not know about it: they need the name of the active theme
and a way to change it.

```ts
export interface ActiveTheme {
  readonly name: string
  readonly list: readonly string[]
  readonly set: (name: string) => void
}
```

On the server `set` is a no-op, in the browser it calls the controller. The
application passes this pair down through its own dependency injection.

## The runtime under Node

The `@feugene/granum/runtime` entry is declared browser-safe: no `node:` imports
and no external dependencies. Browser-safe does not mean it breaks on the server:
without a DOM the controller is constructed, answers questions about the list and
the current theme, and simply does not apply it. That makes it usable on the
server for validating a theme name.

## What to check in your own application

The `apps/app-ssr` stand checks this with a script that imports the built server
bundle and renders with it. The minimum set for your own application:

1. the same request produces the same markup;
2. the active theme is visible in the markup, and reading it back from the root
   returns the same theme;
3. starting the controller does not change the root, while switching does;
4. an unknown theme name falls back to the default one;
5. there is exactly one CSS asset and the template references it.
