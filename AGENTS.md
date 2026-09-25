# AGENTS.md

A [Prettier](https://prettier.io/) plugin that formats the Motoko language, plus a standalone `mo-fmt` CLI.

The plugin is being rebuilt on the [tree-sitter-motoko](https://github.com/caffeinelabs/tree-sitter-motoko) grammar; `docs/formatter-rework.md` is the plan.
The published 0.13 engine lives on `release/0.13`, which takes critical fixes only.

## Build, test, format

Run from the repository root, on Node 22 or later:

- Install: `npm ci`.
- Build: `npm run build` (compiles `src/` to `lib/` and copies the grammar and runtime wasm into `lib/parser/`).
- Test: `npm test` (Vitest, runs the TypeScript sources directly).
- Typecheck: `npm run typecheck` (sources, then tests and tools).
- Format the codebase: `npx prettier --write .` (4-space indent, single quotes, semicolons, trailing commas).

The corpus test needs the compiler and motoko-core checked out as siblings, `../motoko` and `../motoko-core`; without them it is skipped.
CI pins both revisions in `.github/workflows/tests.yml` and sets `MOTOKO_CORPUS_REQUIRED` so a missing checkout fails instead of skipping.

## Layout

- `src/parser/` — tree-sitter initialisation, the normalised tree, and syntax errors.
- `src/parser/nodes.generated.ts` — generated from the grammar by `npm run gen:node-types`; never hand-edit it. CI checks it is current.
- `tools/` — the node-type generator, the build's wasm copy step and the mo-fmt bundler.
- `tests/` — Vitest suites; `tests/fixtures/` holds parser fixtures for rare constructs.
- `packages/mo-fmt/` — the standalone CLI. It imports the plugin from `src/`, and `npm run build:mo-fmt` bundles both, with Prettier, into `packages/mo-fmt/dist/mo-fmt.cjs`. Its tests are `tests/mo-fmt.test.ts`.

## Conventions and gotchas

- `lib/` is generated and gitignored.
- `tree-sitter-motoko` and `web-tree-sitter` are pinned exactly: a grammar minor bump changes tree shapes, and the runtime must load the grammar's ABI. After bumping the grammar, run `npm run gen:node-types`.
- The grammar is a devDependency only. Its install script builds native bindings, so the build copies its wasm into `lib/` instead of depending on it at runtime.
- `.npmrc` sets `min-release-age=7`, so newly published dependency versions are held back for 7 days.
