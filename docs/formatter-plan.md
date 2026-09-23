# Motoko formatting: where it is and where it goes

## Today

There is one Motoko formatter: this Prettier plugin. Everything else wraps it.

How people run it:

- **vscode-motoko** bundles the plugin. "Format document" calls Prettier 2.8 in-process with the plugin. Pinned to plugin 0.12.0.
- **mops** bundles the plugin. `mops format` calls Prettier 3 in-process with the plugin. Pinned to plugin 0.12.1.
- **motoko-playground** bundles the plugin from source.
- **mo-fmt** (`packages/mo-fmt` in this repo) is a CLI that bundles Prettier 2 and the plugin into one binary. npm has 0.13.0. The GitHub binaries stop at 0.12.2. Nobody in the ecosystem calls it.
- `.prettierrc` is the config for all of them. Plugin options live there too.

How the plugin works:

- It does not parse Motoko. It gets a flat token tree from a small Rust lexer (crate `motoko` from **motoko.rs**, compiled to wasm) and decides spacing between neighbouring tokens with a rule table.
- Semicolons are guessed from line shape before lexing.
- It has no idea what an `if` or a `case` is. So it cannot insert braces or drop parens.
- Under moc 2.0.0-beta it breaks code: `if (c) [e] else [f]` becomes `(c)[e]`, `if f(x) { }` becomes `f (x)`, `opt ?? { x = 0 }` becomes `??{`. Whitespace now carries meaning and the plugin does not know where.

Repos in the picture:

| repo | role |
|---|---|
| caffeinelabs/prettier-plugin-motoko | the plugin, the wasm shim, `mo-fmt` |
| caffeinelabs/motoko.rs | the lexer behind the wasm shim. Its parser and interpreter are unused. |
| caffeinelabs/mops | bundles the plugin, `mops format`, the toolchain (`moc`, `lintoko`) |
| caffeinelabs/vscode-motoko | bundles the plugin, format on save |
| dfinity/motoko-playground | bundles the plugin |
| caffeinelabs/tree-sitter-motoko | the grammar lintoko uses. Now parses moc 2.0 syntax (PR #25). |
| caffeinelabs/lintoko | linter on top of tree-sitter-motoko, pins the grammar by git rev |
| caffeinelabs/motoko | the compiler. Source of truth for the syntax. moc 2.0 adds the new forms, v3 removes the old ones (#6352). |

## Plan for moc v2

The rewrite to the new syntax is opt-in. Default output keeps the code as the author wrote it.

### 1. Grammar

tree-sitter-motoko parses both the legacy and the moc 2.0 syntax. Done in PR #25. PR #26 adds a CI job that parses the production packages at source head.

### 2. Plugin: real parser

- Replace the token tree with the tree-sitter CST. Use `web-tree-sitter` and the grammar wasm from the `tree-sitter-motoko` npm package.
- Convert the tree to plain objects. Hoist comments into `ast.comments`. Prettier attaches them.
- Init the parser once, then parse synchronously. This keeps Prettier 2 working in vscode-motoko and mo-fmt.
- A parse error fails the format. Today the plugin emits garbage instead.
- Drop the motoko.rs wasm shim. Nothing needs it anymore.
- Keep the old token printer for `.did` files only.

### 3. Plugin: new printer

- One printer over the CST. Semicolons come from structure, not from line shape.
- Keep parens as written. The grammar has no operator precedence yet, so the printer must not add or remove them.
- New option in `.prettierrc`:

```json
{ "motokoSyntax": "preserve" }
```

- `preserve` (default): layout only. Every construct keeps its shape. Output stays valid on whatever compiler accepted the input.
- `moc2`: rewrite to the target syntax. Brace bare branches and case arms. Drop head parens (`if (c)` to `if c`, records keep them). Drop `;` between cases. Unwrap single case patterns. Print heads tight (`f(x)`, `xs[i]`). `func f() : T = e` stays as is.
- `moc2` output needs moc 2.0. That is why it is off by default. While moc 2.0 is in beta the rewrite may change between plugin versions. The default flips when moc 2.0 is the default toolchain, as a major version. A `moc3` value can follow when the compiler drops the old forms.
- Same shape as scalafmt's `rewrite.scala3.convertToNewSyntax` and Prettier's own `preserve` values: rewrite is a separate opt-in, `preserve` means keep the input.

### 4. Plugin: safety checks

For the corpus (compiler tests, motoko-core, the package set):

1. Format twice, output must not change.
2. Re-parse the output with tree-sitter, no error nodes.
3. Parse input and output with moc.js, compare the ASTs after normalising single-statement blocks.

### 5. mo-fmt: the toolchain artifact

Prettier version and plugin version are two numbers. Only a self-contained binary pins both. mo-fmt is that binary.

- Rebuild packaging: current Node, arm64 for Linux and macOS, wasm files bundled in, asset names mops can build from the version.
- Tag-triggered release workflow, like lintoko.
- mo-fmt version stays equal to the plugin version.

### 6. mops

- Add `mo-fmt` to the toolchain next to `moc` and `lintoko`. Same download code as lintoko.
- `mops format` shells out to the pinned mo-fmt when `[toolchain] mo-fmt` is set. Otherwise it uses the bundled plugin as today.
- Pre-release versions work as they do for moc.

### 7. vscode-motoko

- Same rule: pinned mo-fmt if the workspace has one, bundled plugin otherwise. It already resolves the pinned moc through the mops toolchain.
- Bump the bundled plugin and call the parser init once in the language server.

### Order

1. Merge the grammar PRs. Release the grammar as 0.2.0-beta.1.
2. Plugin: parser swap and printer, `preserve` mode only, at parity with today.
3. Plugin: `v2` mode and the safety checks.
4. mo-fmt packaging and release workflow.
5. mops toolchain entry. vscode-motoko follows.

Not in scope: fixing operator precedence in the grammar, formatting Candid with a real parser, the `= e` function body.
