# granum

Build pipeline for granular UI packages. A provider package publishes components,
their styles, design tokens and themes together with a machine-generated
`granum.manifest.json`; the application resolves one selection of components and
feeds three channels from it — JavaScript, CSS with cascade layers, tokens and
themes. The utility engine is a replaceable adapter inside the CSS channel.

Successor of `@feugene/unocss-preset-granular`. Status: **stage 0 — repository
skeleton**; the package exposes its entry points but no behaviour yet.

## Repository

| Path | Purpose |
|---|---|
| `packages/granum` | the package: `.`, `./contract`, `./engine`, `./build`, `./vite`, `./node`, `./runtime`, `./codegen`, CLI `granum` |
| `fixtures/*` | reference provider packages (from stage 4) |
| `apps/*` | integration apps and size benchmarks (from stage 5) |
| `docs/` | technical specification, invariants, manifest format, decisions, plan |
| `docs/en`, `docs/ru` | user guides, mirrored |

## Specification

- [Technical specification](./docs/spec.md)
- [Invariants](./docs/invariants.md)
- [Manifest format](./docs/manifest.md)
- [Architecture decisions](./docs/decisions.md)
- [Implementation plan](./docs/plan.md)
- [User guides](./docs/en/README.md)

## Commands

```bash
yarn install
yarn lint && yarn typecheck && yarn test
yarn build && yarn check:boundary
yarn test:all
```

## License

MIT
