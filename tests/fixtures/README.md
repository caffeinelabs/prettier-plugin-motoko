# Fixture corpus

`.mo` files scanned by `tests/corpus.test.ts` as its third root, after `../motoko/test` and
`../motoko-core/src`. Those two roots only exist in a developer checkout or in the CI job that
clones them, so without this directory a bare `npm test` would run the corpus test over zero files
and skip ([`describe.skipIf(files.length === 0)`](../corpus.test.ts)) — green, having checked
nothing. These files are what keeps the fast lane honest.

Every file here must **parse and round-trip exactly**. That is a different bar from the sibling
roots, where a grammar rejection is counted and tolerated (the negative fixtures under
`motoko/test/fail` are _supposed_ to fail). Anything in this directory that the grammar cannot
parse is a bug in the grammar or in the normaliser, and the test fails on it.

## What is here, and why

The organising rule is **rare constructs**. The sibling roots are large real code, which is exactly
what makes them good at catching the common cases and bad at catching the uncommon ones: a construct
that appears twice in 1,828 files can be absent from any single checkout's subset, and a node kind
the printer will switch on never gets exercised. A file here is one that earns its place by covering
something the big roots probably do not.

- `head-mode.mo` — the six constructs that appear in head position (an unparenthesised control
  head, where `{` opens a body). This is the one place where the grammar's alias makes a node's
  visible `type` ambiguous, so it is the fixture behind `docs/normalize.md` §4.2–4.3 and the
  `HEAD_SYMBOL_IDS` set. Both alias shapes are present on purpose: `not`/`par` are aliased back to
  their _bare_ names (no mode suffix to read) while `call`/`dot`/`array_idx`/`bin` get `_block`.
  A regression in `modeOf` shows up on the first and not the second.
- `objects-and-fields.mo` — object bodies, records, classes, actors, mixins, and the field
  forms (`exp_field`, `dec_field`, `val_tf`/`var_tf`/`func_tf`/`typ_tf`). The grammar's `obj_body`
  recurses, so shallow coverage can miss a whole nesting level.
- `patterns.mo` — every `*_pat` kind: `alt_pat`, `and_pat`, `annot_pat`, `lit_pat`, `obj_pat`,
  `quest_pat`, `tag_pat`, `tup_pat`, `unop_pat`, `var_pat`, `wild_pat`.
- `types.mo` — every `*_typ` kind, including the ones that only appear in a type position
  (`func_typ`, `obj_typ`, `variant_typ`, `weak_typ`, `or_typ`, `and_typ`, `quest_typ`).
- `control-flow.mo` — `for`, `while`, `loop`, `label`/`break`/`continue` with labels, `do`/`do ?`,
  `try`/`catch`/`finally`, `throw`, `return`, `assert`, `ignore`, `switch` with guards.
- `async-and-await.mo` — `async`, `async*`, the three `await` forms, `shared`/`query`/`<system>`, and
  the sibling unaries that share their production (`debug`, `debug_show`, `from_candid`,
  `to_candid`). The three `await`s differ by a one-character suffix, so a printer that grouped them
  by a shared prefix corrupts two of the three.
- `literals.mo` — every literal kind, with the awkward ones that the round-trip is most likely to
  break on: non-ASCII, characters outside the BMP, escapes, nested block comments, and the
  `comment_text` leaf that `docs/normalize.md` §5.2 requires be treated as opaque source text.
- `declarations.mo` — `import`, `module`, `let`/`var`/`let … else`, `type`, `public`/`private`,
  `debug`/`debug_show`. Imports are here rather than with the expressions because the production is
  `IMPORT <pat> EQ? <TEXT>`: `import C = A;` reads like the JavaScript form and is **not** valid
  Motoko, so the fixture pins the shape the grammar actually accepts.

## Adding a file

Keep them small and hand-readable — the point is that a human can see what broke when one does.
A file that is a copy of real-world code belongs in the sibling roots instead, where it will be
picked up automatically. If a file has to be excluded from the corpus scan for any reason, that is
a reason not to add it here: this directory has no exclusion mechanism, by design.

## Validating a new file

Every construct in this directory was checked against a real `moc` before being written down, and
that step is not optional. Two fixture bugs of that kind were caught this way and neither would
have failed a test:

- `type H = async Nat -> async Nat;` — moc rejects it at the `->`, so it was never valid Motoko.
- `include Inner;` — `include` takes an _expression_ (`INCLUDE x=id e=exp`), so the `()` in
  `include Inner();` is load-bearing rather than stylistic.

A fixture that only the tree-sitter grammar accepts is worse than no fixture: it pins a deviation
as if it were the language. Run `moc --check` on the file and confirm **zero syntax errors** before
adding it. Type errors and warnings are fine — a fixture is allowed to be nonsense semantically,
and several here are (`0x1.8p3` binds to a `Nat`, `to_candid` output is never used). Syntax errors
are not.
