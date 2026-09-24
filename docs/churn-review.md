# Churn review — 0.13.0 against the `preserve` printer

This is M2's _"the diff is reviewed per construct"_ (`docs/formatter-rework.md:155`). The plan asks
for the 0.13.0-vs-`preserve` diff to be read construct by construct before the beta, because the
diff is the evidence that the new style is the intended one and that the parity gap is understood
rather than assumed. The prerequisite artifact is the generated report, `tools/corpus/CHURN.md`
(written by `node tools/corpus/churn.mjs`, gitignored). This document is the reading of it.

Every number below is measured, and every probe that produced one is committed next to this
document at `tools/probe/churn/`, so each claim can be re-run rather than taken on trust. Each is a
script that loads both engines in one process the way `churn.mjs` does and prints the table it is
cited for; run one with `node --experimental-strip-types <path>` (Node strips the types, so the
probes need no build step and no `tsx` dependency), from the repository root.

They fall into two groups. Most are corpus-wide and take no arguments, so they reproduce a whole
section's numbers on their own — `preserve.mts` (the headline), `explain.mts`, `reconcile.mts`,
`verifyclaims.mts`, `attribute.mts`, `importblank.mts`. The rest are pointed at specific inputs:
`qroneitem.mts`, `qrhunk.mts` and `over80b.mts` take corpus paths on the command line (the paths the
sections below name), `failbuckets.mts` takes the corpus roots, and `semi3.mts`, `twomech.mts` and
`list87.mts` carry their inputs inline and need no arguments at all. `unanalysable.mts` carries its
15-file list inline too, since that set comes from `explain.mts`'s output.

Two of them reach outside the repository, and each says what it needs: the corpus probes resolve
`../motoko` and `../motoko-core` as siblings (the layout `AGENTS.md` documents for the compiler
suite), and every probe that loads 0.13.0 reads it from `/tmp/churn013` unless `CHURN_OLD_HOME` names
another install — the same `npm install prettier@2.8.8 prettier-plugin-motoko@0.13.0` pair
`churn.mjs` uses. `moccheck.mts` and the two `moc` cross-checks in "No regressions" additionally
want a `moc` at `/tmp/moctar/moc`.

## The headline, and what it does and does not say

| bucket                                              |     files | share |
| --------------------------------------------------- | --------: | ----: |
| identical                                           |       326 | 17.8% |
| layout-only (same token text, different whitespace) |       612 | 33.3% |
| token-differs (a stronger claim)                    |       874 | 47.6% |
| old-error / both-error / unreadable                 | 0 / 0 / 0 |     — |
| new-error                                           |        24 |  1.3% |

1836 scanned, 1812 compared. **A 47.6% `token-differs` tier is not a defect count.** It is the tier
boundary of the report's own classifier (`churn.mjs:782`, `stripWhitespace(oldOut) ===
stripWhitespace(newOut)`), and the sections below show that the overwhelming majority of it is one
rule applied consistently, not 874 independent surprises. The reverse reading — driving the tier to
zero — is what M2 explicitly does _not_ want: zero differences would mean the new printer is a
reimplementation of 0.13.0, which is the opposite of the rework's purpose.

## The one rule that dominates the diff: implicit separators

`preserve` prints the separators the **source** wrote. 0.13.0 printed the separators the **style**
wanted. `docs/style.md:171-205` is explicit that under `preserve` "every `ifBreak`, `trailingComma`,
and `semi` cell in [the separator table] is **inert**", because "a separator is a token" and the
runtime guard (`src/verify.ts`) re-parses every output and compares shapes — so the printer is
forbidden from adding or removing one. The table is kept in `style.md` because it is the
specification `moc2` (M3) implements.

That difference is measurable against the source itself, which is the right reference point because
it makes the measurement engine-independent.

**Probe `tools/probe/churn/preserve.mts`** — for each of the 1812 comparable files, is the token multiset of
each engine's output equal to the token multiset of the _source_?

| engine           | files whose output has the source token multiset |
| ---------------- | -----------------------------------------------: |
| `preserve` (new) |                                  **1802 / 1812** |
| 0.13.0 (old)     |                                   **945 / 1812** |

`preserve` is a measurement, not an aspiration: the printed token stream is the input's, in 1802 of
1812 files. **Probe `tools/probe/churn/semi3.mts`** pins the mechanism on minimal inputs, and it is the
opposite of the guess one would make from the report alone:

```
IN   let o = { a = 1; };          <- source writes the optional trailing `;`
OLD  "let o = { a = 1 };\n"       <- 0.13.0 DROPS it (the moc2 optional-trailing-separator cell)
NEW  "let o = { a = 1; };\n"      <- preserve keeps it
```

```
IN   let f = func() { 1 };        <- source omits it
OLD  "let f = func() { 1 };\n"
NEW  "let f = func() { 1 };\n"    <- agree: neither invents one
```

Across the corpus (**`tools/probe/churn/preserve.mts`**, same run), of the files where 0.13.0 fails to
preserve the source multiset: **732 gain a `;`** the source left implicit and **72 lose a `;`** the
source wrote. So the diff has two directions, and they are both the old engine implementing the
`moc2` cells that `preserve` cannot.

The 10 files where the new engine does not preserve the source multiset are **not** a guard failure.
Every one is a line comment whose source text ends in a space (`//MOC-FLAG --…-persist `,
`// CHECK: … offset= `); Prettier's own line writer strips trailing whitespace from a line it
terminates, so the space cannot survive printing. `src/verify.ts:100-135` documents exactly this and
forgives only that run, and only for a line comment. The corpus tool reports the same fact from the
other side: those 10 are among its occurrences of the tolerance.

## The second rule: `fill` became one item per line

`docs/style.md:354-368` states the block rule — one line if the whole construct fits in `printWidth`
and holds no hard break of its own, otherwise one item per line, each indented one level, closing
delimiter on its own line. 0.13.0 `fill`ed long lists, packing several short items per line; the new
printer breaks them one per line. That is the source of the single largest outlier in the report,
`test/perf/qr/common.mo` (720 lines → 3818). **`tools/probe/churn/qroneitem.mts`** measures the signature
directly: the old output has 207 lines carrying two or more commas and a maximum of **80 commas on a
single line**; the new output has 124 such lines and a maximum of **18**, with the runs broken one
item per line. The first of the two largest changed regions is `old[108:521] → new[108:3384]` — the
new side is ~15× the old for the same tokens, which is what `fill` → one-per-line looks like and is
not what a rewrite looks like. **`tools/probe/churn/qrhunk.mts`** prints those runs (53 of them, the
largest the one just quoted) without depending on a diff library. The exact offsets do depend on the
diff algorithm; the invariant that does not is the per-line item count.

The same rule accounts for the other large removals: `bench/alloc.mo`'s `while` body fitting on one
line, and the blank-after-`{` drop, both from `style.md:86-113`'s blank-line rules plus the block
rule. **Probe `tools/probe/churn/twomech.mts`** reproduces both minimally, and where the source already had the
canonical shape the two engines are byte-identical ("blank between decls" and "two blanks → one"
both produce identical output from both engines), which is what a style change looks like rather than
a rewrite.

`tools/probe/churn/over80b.mts` measures the intended effect on `printWidth` adherence, counting lines strictly
longer than 80 columns:

| file                      | >80-col lines, old → new |
| ------------------------- | ------------------------ |
| `test/run/explode.mo`     | 3 → 0                    |
| `test/run/aardvark.mo`    | 1 → 0                    |
| `test/run/ranged-nums.mo` | 8 → 0                    |
| `test/run/candid.mo`      | 17 → 3                   |

The three survivors on `candid.mo` are a verbatim comment (84 cols), a verbatim literal (131), and
another verbatim comment (92) — text the style forbids breaking, so they are correct overflows rather
than missed wraps.

## Reconciling the two classifiers

The report tiers by _text_ (`stripWhitespace`, which deletes whitespace and so cannot tell a moved
token from a restyled one). A token multiset is the better content test, and the two agree once the
difference is named. **Probe `tools/probe/churn/reconcile.mts`**:

| measurement over the 1486 differing files                                    | files |
| ---------------------------------------------------------------------------- | ----: |
| whitespace-stripped output equal (`churn.mjs` "layout-only")                 |   612 |
| token multiset equal but whitespace-stripped **unequal** — a token **moved** |    27 |
| token multiset unequal (`churn.mjs` "token-differs" content)                 |   847 |

612 + 27 + 847 = 1486. The 27-file middle bucket is the case the text test cannot see: the same
tokens in a different sequence, an implicit separator relocated rather than added or dropped.
**`tools/probe/churn/verifyclaims.mts`** finds the first position at which the two token sequences diverge in
each: 22 of the 27 are `}` followed by `;` in the old output against `;` followed by `}` in the new,
and the other 5 are the reverse. That is one mechanism, named exactly — the optional separator's
position relative to the closing brace — which is the first section's rule seen through a projection
that preserves order.

**`tools/probe/churn/verifyclaims.mts`** also fixes the shape of the old engine's non-`;` differences, which is
where a real behavioural disagreement would hide. Classifying each of the 841 content-differing files
by what is left once every `;` difference is set aside: **783 differ by `;` alone**, **50 by a
comma**, and **8 by some other code token** (`await?`/`await`, `0.`/`0`/`.`, `async*`/`async`). No
file differs by a node type — `tools/probe/churn/explain.mts` puts the "token text differs, node types equal"
cell at 839 of the 1486 — so the two engines are printing the same program throughout.

## No regressions

The failure buckets are the part where the review has to be able to say "no", and they are empty:

- **0 files** whose new output fails to re-parse. `verify.ts` re-parses every output before it is
  written, so this is enforced rather than measured — but `tools/probe/churn/attribute.mts` independently
  re-parses both engines' outputs and attributes the failures: **15 files where the old engine's
  output fails the grammar, 0 where the new engine's does, 0 where both do.** Every one of the 15 is
  the documented `leading-ws-bug` family (below). The same probe finds exactly one file where respacing
  alone moved the parse — `test/fail/syntax-head-prefix-op.mo`, a head-prefix-operator fixture,
  which is the whitespace-sensitive parse that deviation is about. `failbuckets.mts` reaches the same
  conclusion from the other end — it scans the corpus roots and names each of the 24 `new-error` files
  while its own "new output does not re-parse" bucket stays at 0 — and `unanalysable.mts` pins the
  direction on the 15-file cell `explain.mts` cannot attribute: 12 of them are the old engine's output
  failing the grammar, 0 the new's.
- **0** both-threw, **0** crashes, **0** unreadable.
- The corpus harness's own counters (`tools/corpus/report.json`): `roundTrip: 0`, `invariant: 0`,
  `printerReParse: 0`, `printerTree: 0`, `printerIdempotence: 0`, `printerOracle: 0`,
  `syntaxErrorsUnexpected: 0`, with all seven checks `"run"` — including `mocOracle` against Motoko
  compiler `1.16.1-26-g1d57a4fc7b`, 5572 files oracle-checked. This is M2's _"zero guard failures,
  zero moc AST mismatches"_, measured.

The **24 new-errors** are not regressions either — the report itself lists all 24 by name, and the
shape is unambiguous: 22 are in `test/fail/`, which holds deliberately invalid Motoko that the old
lossless-token engine would "format" and the new one correctly refuses (`src/parser/parse.ts`'s
header: formatting an ERROR/MISSING tree "would silently rewrite code the printer never understood").
The remaining two are already-documented deviations, each with an in-tree repro, each now
compiler-checked rather than asserted:

- `test/perf/qr/list.mo` — `List <T>` with a space at line 87, grammar `leading-ws-bug`,
  `grammar-deviations.md` item 4 (`:724`), upstream in the generator. **`/tmp/moctar/moc -dp` on the
  file reports zero syntax errors**, so moc _accepts_ what the grammar cannot parse — which is the
  deviation stated exactly. **`tools/probe/churn/list87.mts`** reproduces it minimally: `let f : List <T> = x;`
  fails, `let f : List<T> = x;` parses.
- `test/run-drun/timer.mo` — `@timer_helper()` at line 20. **`moc -dp` reports
  `syntax error [M0002], privileged identifier` on that line**, so the file is not valid Motoko and
  neither engine's inability to format it is a printer fact.

## What this review does not cover

Two things are deliberately out of scope here and stay on M2's list, both invisible to every gate
that is currently green:

- **The import-section blank-line rule** (`docs/style.md:114-130`) is unimplemented: `sourceFileDoc`
  has no import branch. Its ported fixture (`tests/format/imports/**`) does not exist yet, and the
  rule is unambiguous — one blank line after the **last** import, before the first declaration; none
  when there are no imports. **Probe `tools/probe/churn/importblank.mts`** measures the corpus against it
  exactly: of 986 files whose leading declaration run is imports, **225** have no blank line after the
  last import where the rule wants one and **46** have two or more where it wants one — 271 files the
  rule will move when it lands. It is a known gap, not a finding of this review.
- **Comment _text_ reflow** is invisible to the tier classifier, as `churn.mjs:1522` notes: a
  reflowed comment lands in `token-differs` beside real token changes. The category is small here (the
  tolerance list above) and the printer emits comment text verbatim, so there is nothing to review
  beyond the trailing-space case.

## Verdict

The `preserve` printer's output is the source's token stream with the style's layout, and the diff
against 0.13.0 is the style moving — the implicit-separator rule (`preserve` keeps what the source
wrote; 0.13.0 materialised or dropped it per `moc2`'s table) and the block rule (`fill` → one item
per line). Both are specified in `docs/style.md`, both are measured, and the second is the direction
that improves `printWidth` adherence. There are **no regressions**: zero guard failures, zero moc AST
mismatches, zero new output that fails to re-parse, and all 24 new-errors accounted for as
deliberately-invalid fixtures or documented grammar deviations. The remaining work is enumerated
above and belongs to M3 (`moc2`, the rewrite passes) and to the ported fixtures.
