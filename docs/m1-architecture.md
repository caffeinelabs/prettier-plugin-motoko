# M1 architecture: the tree-sitter engine

This is the concrete target for the reset described in [formatter-rework.md](formatter-rework.md).
It fixes the module boundaries, the data flow, and the non-negotiables, so the printer and rewrite
PRs have a stable contract to build against. Where this file and the plan disagree, the plan wins
and this file is the bug.

## Scope of this milestone

M1 delivers parse only. No printer, no rewrite. Its exit criterion is the plan's:

> **Exit: 100% of the corpus parses and round-trips.**

Measured on 2026-09-23 ([RESULTS](../tools/corpus/RESULTS.md)), the honest number is **96.4%**
(2421/2511 units of the motoko corpus at `master`). The 3.6% is not a formatter bug and not
something this milestone can fix by writing better code; it is a set of grammar gaps, catalogued in
[grammar-deviations.md](grammar-deviations.md). M1 therefore exits with the corpus harness green on
every unit it can reach, every unreachable unit counted and listed, and the gaps filed upstream.

## Non-negotiables

1. **Prettier 3 only.** No compatibility shims, no `prettier@2` overload, no sync parse.
2. **ESM only**, built with `tsc` to `lib/`, Node ≥ 22 at runtime.
3. **The runtime guard throws.** `verify.ts` runs on every format call, has no opt-out, and fails
   the format rather than writing output it cannot prove equivalent.
4. **The grammar is pinned exactly.** A minor grammar bump changes tree shape, so the pin is the
   contract the generated node types are generated from.
5. **No `.did`, no Rust, no wasm-pack.** Nothing in this repo parses Candid.
6. **`preserve` means the output means the same under moc 1.x _and_ moc 2.0 lexing.** Whitespace is
   normalised only where both lexers agree. The rules are [adjacency.md](adjacency.md).

## Module layout

```
packages/prettier-plugin-motoko/
  src/
    index.ts                  languages, parsers, printers, options — the Prettier entry
    parser/
      tree-sitter.ts          lazy, memoised init of web-tree-sitter + the pinned grammar
      parse.ts                text -> CST -> normalised tree; ERROR/MISSING -> SyntaxError with loc
      normalize.ts            plain objects: type, mode, fields, children incl. tokens, start/end
      nodes.generated.ts      discriminated union generated from node-types.json
    comments/                 attach handlers (ownLine / endOfLine / remaining)
    printer/                  one module per area: dec, exp, control, pat, typ, obj, imports
      adjacency.ts            the whitespace-sensitive token pairs, in one place
    rewrite/moc2/             one module per rewrite rule, each with its own precondition
    verify.ts                 runtime guard: re-parse the output and compare trees
    options.ts
  tools/
    gen-node-types.ts         regenerates nodes.generated.ts from the pinned grammar
  mo-fmt/                     SEA binaries; depends on the workspace plugin
```

## Data flow

One format call, in order. Every arrow is a place a bug can hide, so each is separately testable.

```
source text
  │
  ├─► parser/tree-sitter.ts     lazy init, memoised for the process lifetime
  │
  ├─► parse.ts                  CST (tree-sitter Tree)
  │     └─ ERROR/MISSING present?  ->  SyntaxError with location, format fails
  │
  ├─► normalize.ts              NormalNode tree; tokens kept as children with offsets
  │
  ├─► comments/                 attach comments to nodes (Prettier comment attachment)
  │
  ├─► rewrite/moc2/*            tree -> tree, only when motokoSyntax is moc2
  │     └─ edit log             every change recorded, for the guard and the skip report
  │
  ├─► printer/*                 NormalNode -> Prettier Doc
  │
  ├─► prettier.doc.printer      Doc -> output text
  │
  └─► verify.ts                 re-parse output, compare with the (possibly rewritten) input tree
        └─ mismatch?  ->  throw, write nothing
```

The guard compares against the **rewritten** input tree, not the original, so `moc2` is covered by
the same check as `preserve`. The comparison's tolerance is exactly the rewrite's edit log: a `ParP`
unwrapped, a single-expression `BlockE` added, a dropped `;`. Anything else is a failure.

## Why tokens are children

The normaliser keeps tokens as children of their parent node, with source offsets. This is not
redundant bookkeeping: it is what makes the corpus harness's **token round-trip** check possible —
re-concatenating tokens and the gaps between them must reproduce the input byte for byte. That
single check proves the normaliser lost nothing, which is the precondition for trusting the
printer's output to be a function of the whole input.

Comment text is the reason offsets, not just token text, are mandatory: comment text is lexed one
character per token (`grammar.js`'s `comment_text` is `repeat1(token(prec(1, /.|\n|\r/)))`), so the
text must always be sliced from source offsets rather than re-joined from token children.

## The three hosts

The plan requires the grammar to load in Node, in a browser build, and inside a Node SEA binary.
M0 measured all three ([RESULTS](../.probe/hosts/RESULTS.md)). The consequences for this milestone:

- `web-tree-sitter` is **pinned exactly**, starting at 0.26.x, because ABI 15 is generated by
  tree-sitter-cli 0.26.10 and loads in `web-tree-sitter` ≥ 0.25.
- The grammar package ships `tree-sitter-motoko.wasm` next to native N-API bindings that have an
  install script. **We vendor the wasm into our build output and keep the grammar a devDependency**,
  so plugin users never run `node-gyp-build`.
- The wasm goes into the SEA binary as an asset; the old externref crash came from the packaging
  layer, not from the wasm, so M0's exit test is a real parse from the packaged binary.

## What M1 does not do

- It does not format. `mo-fmt` and the plugin both still run the old engine until the printer lands.
- It does not implement the guard's printer side; `verify.ts` lands with the printer skeleton, since
  there is nothing to re-parse until then.
- It does not close the grammar gaps. It measures and reports them.
