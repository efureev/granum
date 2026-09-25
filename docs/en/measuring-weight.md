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
  css                             0        2 441   +2 441
  entry                         617          756     +139
  pkg                             0        2 093   +2 093
  vue                        23 180       23 618     +438
  всего                      23 797       28 908   +5 111
  без vue                       617        5 290   +4 673

СЛОИ GRANUM (из бандла после минификации, granum-report.json)      raw     gzip
  tokens                                                      1 258      566
  base                                                          588      322
  themes                                                      3 743      956
  components                                                    773      347
  utilities                                                   2 192      626

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

## Comparison with the v1 preset

`apps/bench-one/v1-snapshot.css` is the CSS of the same stand built with
`@feugene/unocss-preset-granular` 0.16.1. `compare-css.mjs` normalises both
outputs into a set of `{ context, selector, declarations }` (`@layer`
wrappers removed, order ignored) and compares them; allowed discrepancies are
listed in `expected-compare.mjs`. The list is empty today: 58 rules on both
sides.
