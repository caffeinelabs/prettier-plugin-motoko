# AGENTS.md

A [Prettier](https://prettier.io/) plugin that formats the Motoko language, plus a standalone `mo-fmt` CLI.

## Build, test, format

Run from the repository root:

- Install: `npm ci` (prettier is also a devDependency, so no separate install is needed).
- Build: `npm run build` (compiles TypeScript to `lib/` and copies the two wasm files the parser loads beside it).
- Test: `npm test` (runs Vitest over `tests/**/*.test.ts`; the sources are executed directly, so there is no build step first).
- Typecheck: `npm run typecheck` (the plugin, then the `tools/` tsconfig).
- Format the codebase: `npx prettier --write .` (this repo's own `.prettierrc` uses 4-space indent, single quotes, semicolons, and trailing commas everywhere).

There is no Rust build. M1 replaced the compiled grammar with a vendored WebAssembly grammar
(`src/parser/tree-sitter-motoko.wasm`), loaded through `web-tree-sitter`.

## Layout

- `src/index.ts` — plugin entry: options, parsers, `astFormat` wiring.
- `src/parser/` — the tree-sitter grammar load, the normaliser (`normalize.ts`, which produces the
  `NormalBranch`/`NormalToken`/`Text` tree the printer walks), generated node types, and syntax
  errors with locations.
- `src/printer/` — the `preserve` printer: `walk.ts` (the traversal and the runtime guard's call
  site), `parts.ts` (list layout, separators, comments), and one module per construct area
  (`chain.ts`, `control.ts`, `exp.ts`, `adjacency.ts`).
- `src/verify.ts` — the runtime guard. Every format call re-parses its own output and compares the
  two trees; a difference throws and nothing is written. It is always on and has no opt-out.
- `packages/mo-fmt/` — separate npm package for the standalone CLI, with its own `package.json`, scripts, and dependencies. Build/test it from inside that directory (e.g. `npm --prefix packages/mo-fmt ci`).
- `tests/` — Vitest suites. `tests/format/**/*.mo` are fixtures (inputs, not expected outputs) whose
  snapshots live in the single shared `tests/__snapshots__/format.test.ts.snap`; `tests/legacy/` holds
  the four pre-rewrite 0.13 suites, kept as golden pairs but excluded from the run;
  `tests/test-webapp/` verifies the web build.
- `tools/` — the corpus harness (`tools/corpus/`), the `moc2` rewrite validator
  (`tools/validate-moc2/`), and the node-type generator.

## Conventions and gotchas

- Generated / never hand-edit: `lib/` (tsc output) and `src/parser/nodes.generated.ts` (built by
  `npm run gen:node-types`). Both are gitignored.
- The vendored `src/parser/tree-sitter-motoko.wasm` **is committed** and must stay that way — it is
  the grammar the plugin loads.
- `.npmrc` sets `min-release-age=7`, so newly published dependency versions are held back for 7 days.
- The `.mo` fixtures are formatted **as one program**, so two adjacent statements with nothing
  between them are a parse error (`Missing ';'`). Top-level `{ … }` is a record literal and needs a
  `;` too.
- `tests/__snapshots__/format.test.ts.snap` is one file shared by every fixture, so a parallel run
  that writes snapshots races. Add `.mo` files freely; run vitest once, serially, to write snapshots.
- `prettier --check` / `npm run format:check` does **not** process `.mo` files (the repo `.prettierrc`
  declares no plugins), but it does cover `docs/*.md`, so a docs change can fail it.
- CI (`.github/workflows/tests.yml`) runs on Node 22 and 24, gates on `npm run typecheck` and
  `npm run format:check`, builds `tests/test-webapp` in a separate job, and clones
  `https://github.com/dfinity/motoko` into `../motoko` (a sibling of this repo) before testing. The
  corpus suite reads Motoko test files from that path, and without it those files are simply absent.
- The release workflow builds the standalone `mo-fmt` binaries on Node 22 with `@yao-pkg/pkg`
  (`node22-*` targets, host arch, so x64 in CI). The plugin's wasm uses reference types, which the
  embedded Node runtime must support; smoke-test a packaged binary on a `.mo` file (format and
  `--check`) when touching this path, not just that packaging exits 0.
- Releases are triggered only by changes to `packages/mo-fmt/package.json` on `main` (`.github/workflows/release.yml`), which tags from that file's `version`.
