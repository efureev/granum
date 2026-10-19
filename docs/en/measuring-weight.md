# Measuring CSS/JS weight

> 🇷🇺 Русская версия: [`../ru/measuring-weight.md`](../ru/measuring-weight.md).

Three stands in `apps/` answer "how much does one component cost" and "what
shipped to the distribution is not used".

| Stand | Contents | Purpose |
|---|---|---|
| `bench-zero` | bare Vue, no granum, no provider | the denominator: the price of an empty app with the same tooling |
| `bench-one` | the granum plugin and one `XhPanel` from the `heavy` fixture (the graph pulls four more) | the subject: the full price of a component on top of the foundation |
| `bench-pruned` | the same plus `pruneTokens: { mode: 'on' }` | the effect of token pruning |

The tooling of the stands is identical except for the plugin and the
provider chunk group: only then is the difference of distributions the price
of the library, not of build settings. `App.vue` of the stands has no class
of its own — otherwise the `utilities` layer stops being attributable.

## Commands

```bash
yarn build:all
yarn sizes            # bench-one against bench-zero, bench-pruned against bench-one
yarn sizes:check      # strict comparison of every stand with expected-budget.mjs
yarn compare:css      # the CSS rule set of bench-one equals the v1 preset snapshot
yarn compare:js       # bench-one JS is byte-equal to a build without the plugin
```

## What the report prints

```
РОЛИ (gzip)              bench-zero    bench-one        Δ
  css                             0        2 591   +2 591
  entry                         617          754     +137
  pkg                             0        1 123   +1 123
  vue                        23 180       23 618     +438
  всего                      23 797       28 086   +4 289
  без vue                       617        4 468   +3 851

СЛОИ GRANUM (из бандла после минификации, granum-report.json)      raw     gzip
  tokens                                                      1 258      566
  base                                                        1 627      617
  themes                                                      3 529    1 013
  components                                                    773      347
  utilities                                                   1 561      424
  total                                                       8 748    2 588

ТОКЕНЫ В ДИСТРИБУТИВЕ: объявлено 117, достижимо 49, мёртвый груз 68
```

Asset roles are `vue`, `pkg` (provider chunks), `css` (all granum CSS in one
file), `entry`. An asset matching no role fails the report: there is no
"other" bucket on purpose. Layers come from the build report: the plugin
splits the built asset by `@layer` blocks after minification
(`sizesSource: 'bundle'`); emission sizes before minification sit next to
them in `emissionSizes`.

Token reachability is computed over the distribution: a root is a reference
outside a custom property value (a CSS rule, a JS literal), then along
declaration values. The pruned stand must show "dead weight 0".

## What is gated

There is no byte threshold: gzip is not reproducible across environments,
and an arbitrary threshold goes red on honest growth. A stand's
`expected-budget.mjs` fixes boolean facts and is checked both ways — a
vanished expected discrepancy is as much an event as a new one:

- the set of asset roles;
- classes without a rule in the report (`shadow-legacy` is a deliberate
  fixture);
- undefined tokens;
- the prune mode and `maxUnused: 0` for `bench-pruned`;
- the engine is not in the client bundle.

Bytes live in `hints` and are printed next to the facts as a reference.

## The neighbouring stand: what is left over

`bench-*` answer "how much does it weigh", `apps/dist-audit` answers "what is
left of the package". It is an application of one `div` and one component on
top of the miniature design system `fixtures/mini-ds-package`: two components,
a theme with two modes, ten tokens with deliberate dead weight.

```bash
yarn workspace @granum-apps/dist-audit audit:dist
```

The audit reads the package manifest, the built CSS and JS and names each
finding: the code of the unselected component (dropped by tree-shaking), its
classes (not taken by the selection), the tokens removed by pruning, and
package tokens in the distribution that nothing can reach. There must be none
of the latter — that is what the stand fails on.

## Comparison with the v1 preset

`apps/bench-one/v1-snapshot.css` is the CSS of the same stand built with
`@feugene/unocss-preset-granular` 0.16.1. `compare-css.mjs` normalises both
outputs into a set of `{ context, selector, declarations }` (`@layer`
wrappers removed, order ignored) and compares them; allowed discrepancies are
listed in `expected-compare.mjs`. There are two, both expected: v1 has
`@keyframes granularity-spin`, which granum does not emit without
`animate-spin`, and the granum preflight (`*`, `:before`, `:after`,
`::backdrop`) declares more variables — the wind3 vocabulary is wider. 58 rules
in v1, 57 in granum. The `--xh-fg-boost` value in the snapshot follows the
fixture: the preset copies the foundation CSS as is.
