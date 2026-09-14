# AGENTS.md

A [Prettier](https://prettier.io/) plugin that formats the Motoko smart contract language, backed by a Rust/WASM parser.

## Build, test, format

Run these from the repository root with Node.js (CI tests on 18.x, 20.x, and 22.x):

- Install: `npm ci`
- Build everything (WASM + TypeScript): `npm run build`
- Build only the WASM parser: `npm run build:wasm` (bundler + nodejs targets)
- Build only TypeScript: `npm run build:ts`
- Test: `npm test` (rebuilds the nodejs WASM target, then runs Jest)
- Test without rebuilding WASM: `npm run test:quick`

This repo is itself formatted with Prettier per `.prettierrc` (4-space tabs, single quotes, trailing commas). There is no dedicated lint script.

## Directory map

- `src/` — TypeScript plugin source. `parsers/motoko-tt-parse/` and `printers/motoko-tt-ast/` implement the token-tree parse and print pipeline; `environments/` holds the Node and web entry points.
- `wasm/` — Rust crate compiled to WebAssembly via `wasm-pack`; wraps the `motoko` crate for parsing.
- `packages/mo-fmt/` — standalone CLI package (`mo-fmt`), released and versioned independently.
- `tests/test-webapp/` — Vite app used to exercise the plugin in a browser environment.

## Conventions and gotchas

- Generated, never hand-edited: `lib/` (tsc output), `wasm/pkg/` (wasm-pack output), and `node_modules/`. `lib/` and `node_modules/` are gitignored; the WASM build scripts delete the `.gitignore` that `wasm-pack` writes into `pkg/`.
- Building WASM requires the Rust toolchain and `wasm-pack`; the nodejs WASM target must be built before Jest can run (`npm test` does this for you).
- `tests/compiler.test.ts` expects the Motoko compiler repo checked out at `../motoko` (CI clones `https://github.com/dfinity/motoko.git` into a sibling directory); its main test case is `test.skip`.
- `packages/mo-fmt` is a separate npm package with its own `package-lock.json`; install and run its scripts with `npm --prefix packages/mo-fmt`. Bumping its `package.json` version on `main` triggers the release workflow.
- `.npmrc` sets `min-release-age=7`, delaying adoption of newly published dependency versions.
- Keep `prettier-plugin-motoko` and `packages/mo-fmt` at matching versions when releasing; the CLI depends on the plugin.
