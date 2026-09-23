# AGENTS.md

A [Prettier](https://prettier.io/) plugin that formats the Motoko language, plus a standalone `mo-fmt` CLI.

## Build, test, format

Run from the repository root:

- Install: `npm ci` (prettier is also a devDependency, so no separate install is needed).
- Build: `npm run build` (builds the Rust wasm crate, then compiles TypeScript to `lib/`).
- Test: `npm test` (rebuilds the Node wasm target, then runs Jest). Use `npm run test:quick` to run Jest without rebuilding wasm.
- Format the codebase: `npx prettier --write .` (this repo's own `.prettierrc` uses 4-space indent, single quotes, semicolons, and trailing commas everywhere).

Building wasm requires the Rust toolchain and `wasm-pack`.

## Layout

- `src/` — TypeScript plugin source. `parsers/` and `printers/` implement the Prettier parse/print pipeline; `environments/` has separate `node` and `web` entry points.
- `wasm/` — Rust crate compiled to WebAssembly (wraps the `motoko` parser); output goes to `wasm/pkg/`.
- `packages/mo-fmt/` — separate npm package for the standalone CLI, with its own `package.json`, scripts, and dependencies. Build/test it from inside that directory (e.g. `npm --prefix packages/mo-fmt ci`).
- `tests/` — Jest suites. `tests/test-webapp/` verifies the web build.

## Conventions and gotchas

- Generated / never hand-edit: `lib/` (tsc output), `wasm/pkg/` and `wasm/target/` (wasm-pack/cargo output). All are gitignored.
- `wasm-bindgen` and `serde-wasm-bindgen` are pinned to exact versions in `wasm/Cargo.toml`; keep them in sync with the installed `wasm-pack`.
- `.npmrc` sets `min-release-age=7`, so newly published dependency versions are held back for 7 days.
- CI (`.github/workflows/tests.yml`) runs on Node 22 and 24, gates on `npm run typecheck` and `npm run format:check`, builds `tests/test-webapp` in a separate job, and clones `https://github.com/dfinity/motoko` into `../motoko` (a sibling of this repo) before testing. The compiler-suite test (currently skipped) reads Motoko test files from that path.
- The release workflow still builds `mo-fmt` on Node 16, because the archived `pkg` packager targets `node16-*`. Keep `packages/mo-fmt` devDependencies Node-16-compatible until it moves to `@yao-pkg/pkg`.
- Releases are triggered only by changes to `packages/mo-fmt/package.json` on `main` (`.github/workflows/release.yml`), which tags from that file's `version`.
