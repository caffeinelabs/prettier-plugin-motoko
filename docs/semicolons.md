# Semicolons: semantics, safety, and what the printer may drop

Evidence for the `;` rules in [`formatter-rework.md`](./formatter-rework.md) §"Semicolons".
This is the highest-risk correctness rule in the plan — a dropped `;` can change a
program's meaning with no syntax error — so every claim here is stated as
**claim → evidence (`file:line`, quoted rule) → verdict**, and the parser-side half is
backed by a runnable probe (`.probe/semi-parse.mjs`).

## Verdicts and what they rest on

| Evidence class                                | What it can establish                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **moc grammar** (`parser.mly`, quoted)        | What the grammar _accepts_ / which AST a parse produces for a rule. Strong for "these two spellings reduce to the same nonterminal".               |
| **moc corpus statistics** (grep over `test/`) | What real 1.x code writes. Corroborates, never proves acceptance.                                                                                  |
| **tree-sitter-motoko 0.2.0** (probe)          | Tree _shape_ equality under a second, independent grammar. A faithful oracle for "does removing this `;` change the parse", not for moc semantics. |
| **executing moc**                             | The only proof of moc-side acceptance.                                                                                                             |

> **Environment limitation — read before trusting any verdict below.**
> There is **no `moc` binary, no `moc.js`, and no OCaml toolchain** in this environment
> (`which moc` → shell alias only; `moc.js`, `ocaml`, `menhir`, `dune` all absent).
> **No moc-side _execution_ was performed.** Every moc claim below is _grammar-reading_,
> _corpus statistics_, or _precedent_, and is labelled as such. The tree-sitter probe is
> executed for real and its raw output is reproduced in §6.

Versions pinned for the cites:

- moc `1.16.1` — last 1.x tag (the "moc 1.x" the plan refers to).
- moc `2.0.0-beta.1` — base `441dd70cd`, head `1d57a4fc` (the tree this rework targets).
- tree-sitter-motoko `0.2.0` (WASM ABI 15), sha256
  `35e710b01a8fc67fe9d34cec8b67b1528d5d3c114ec4cf121f03dd5c9632fbf9`.

---

## 1. Is the trailing `;` ever semantically meaningful?

**Claim (plan, line 88).** "The trailing `;` never changes meaning: moc's `seplist`
gives `{ a; b }` and `{ a; b; }` the same AST (parser.mly:378)."

**Evidence — the cited rule, at the cited location.** `motoko/src/mo_frontend/parser.mly`
(lines 377-392 verbatim, base `441dd70cd` **and** head `1d57a4fc` are byte-identical here):

```
377: (* recovery comment: force to insert ";" rather immediate reduction *)
378: seplist(X, SEP) :
379:   | (* empty *) { [] }
380:   | x=X { [x] } [@recover.cost inf]
381:   | x=X SEP xs=seplist(X, SEP) { x::xs }
382:
383: seplist1(X, SEP) :
384:   | x=X { [x] }
385:   | x=X SEP xs=seplist(X, SEP) { x::xs }
...
390: %inline semicolon :
391:   | SEMICOLON
392:   | SEMICOLON_EOL { () }
```

The citation **is correct**: `seplist` is at `parser.mly:378-381`, and `;` fills `SEP`
via the `%inline semicolon` rule at 390-392.

**Why the trailing `SEP` is inert.** `seplist` has exactly three arms; the third is
`x SEP xs` where `xs` is itself a `seplist`. So the two candidate parses are:

- `{ a; b }` → `seplist` = `a` `SEP` `seplist(b)` = `a` `SEP` `b` `SEP` `seplist()` = `a ; b` (empty tail)
- `{ a; b; }` → `seplist` = `a` `SEP` `seplist(b ;)` = `a` `SEP` `b` `SEP` `seplist()` = `a ; b`

Both are the same list `[a; b]`: the `;` after the final item reduces to the **empty**
arm 379, contributing no element and no AST node. There is **no empty-item arm**, so a
`;` can only ever be a _separator_ for `seplist`, never a terminator that adds
something. Symmetrically, `seplist1` (383-385, the non-empty-only variant used by
variant types and `with`-object fields) allows an optional trailing `SEP` via its own
`x SEP xs` arm, giving the same list either way.

The consequences: a trailing `;` cannot carry a value, cannot introduce a statement,
and cannot disambiguate anything (it is always the _last_ token before `}`).

**Verdict: CONFIRMED**, by grammar-reading of the cited rule. Corroborated (not proved)
by the probe: 32/43 cases that differ only by a trailing `;` produce **byte-identical
normalised trees** (§6), and by the tree-sitter grammar, whose `semi_sep`/`semi_sep1`
helpers mirror the same shape (`/tmp/tscheck/package/grammar.js`: `semi_sep` =
`repeat(seq(rule,";")) optional(rule)`).

**Where this does NOT extend.** "Trailing" is load-bearing. An **interior** `;` is
mandatory (it is the only arm that consumes `SEP`), and dropping it is _not_ inert —
see §4. The plan's sentence is true only of the separator after the **last** item.

---

## 2. Constructs where inserting / removing a `;` changes the parse

All "identical" rows below are `seplist`/`seplist1` sites: the trailing `;` is inert by
§1. The interesting ones are the ones that are _not_ seplist sites, or where the `;` is
interior.

**Evidence — the seplist/`seplist1` call sites** (`parser.mly`, base = head):

| Construct                   | Rule                                                                              | Line       | Kind               |
| --------------------------- | --------------------------------------------------------------------------------- | ---------- | ------------------ |
| block `{ … }`               | `LCURLY ds=seplist(dec, semicolon) RCURLY`                                        | 1013       | trailing inert     |
| record literal              | `LCURLY efs=seplist(exp_field, semicolon) RCURLY`                                 | 685        | trailing inert     |
| record `with`               | `… WITH efs=seplist1(exp_field, semicolon) RCURLY`                                | 689        | trailing inert     |
| object type body            | `LCURLY tfs=seplist(typ_field, semicolon) RCURLY`                                 | 473        | trailing inert     |
| variant type `{ #a; #b }`   | `LCURLY tfs=seplist1(typ_tag, semicolon) RCURLY`                                  | 479        | trailing inert     |
| module / actor / class body | same `block` / `seplist(dec, semicolon)`; top level `seplist(dec, semicolon) EOF` | 1013, 1341 | trailing inert     |
| tuple / paren type          | `lpar ts=seplist(typ_item, COMMA) RPAR`                                           | 483        | **comma**, not `;` |
| tuple pattern               | `seplist(pat_bin, COMMA)` (no trailing-comma arm)                                 | 1137-1141  | **comma**          |

**The constructs that are NOT `seplist` sites, and therefore need individual treatment:**

1. **`case` arms (bare and braced)** — handled by the separate `cases` rule, not
   `seplist`; the `;` is _optional_ but must be placed correctly. See §3. This is the
   one construct the plan singles out, and it is the one where the two moc versions
   differ.
2. **`switch` / `try … catch` arms** — same `cases` rule (see §3).
3. **Two statements that both end in `}`** — the plan's `if c { … };` case. The `;` is
   the _interior_ separator of a `seplist(dec, semicolon)` and is **mandatory**.
4. **A `}`-ending statement followed by a `(`- or `[`-starting statement** — mandatory,
   and _silently mis-parsed_ if dropped. See §4; this is the dangerous one.

**Verdict: PARTIALLY CONFIRMED.** Inserting a trailing `;` anywhere a `seplist`/
`seplist1` ends is inert (32 probe cases). But the plan's framing ("the trailing `;`
never changes meaning") must not be read as "any `;` you add or remove is inert": the
mandatory interior separator is a different token role, and §4 shows it is not.

### The `ifBreak` two-spellings question

The plan prints `;` only when a block breaks (`ifBreak(";")`), so **the same source can
print two ways**: one-line with no trailing `;`, multi-line with it. The obvious hazard
is that the two spellings differ in the AST.

**Claim.** The two spellings are the same AST.

**Evidence — probe.** `ifbreak-one-line` and `ifbreak-broken` are both `IDENTICAL`
(normalised trees equal). Concretely, `block-trailing-semi` (`{ a; b }` vs `{ a; b; }`)
and `block-two-lines-trailing` (the broken form) both normalise equal.

**Verdict: CONFIRMED** — the `ifBreak` trailing `;` is safe, because it is exactly the
`seplist` trailing separator of §1. (Contrast: emitting `;` _between_ items in a broken
block is mandatory, not a choice — dropping those is §4.)

---

## 3. The `preserve` vs `moc2` asymmetry after a braced `case` arm

**Claim (plan, line 90).** "No `;` between `case` arms, since `case` already ends the
previous arm. `moc2` drops it after a braced arm. `preserve` keeps it, because moc 1.x
needs it after a bare arm."

Two sub-claims: (a) `moc2` may drop `;` after a **braced** arm; (b) `preserve` must keep
it because **bare** arms need it on moc 1.x.

**Evidence — the grammar changed between 1.16.1 and base/head.**

moc **2.0.0-beta.1** (base/head, `parser.mly:1016-1024`):

```
1016: case :
1017:   | CASE p=case_pat e=legacy_body(ob)
1018:     { {pat = p; exp = e} @@ at $sloc }
1019:
1020: (* The `;` between cases is optional: every case starts with the `case` keyword, so the separator disambiguates nothing. *)
1021: cases :
1022:   | (* empty *) { [] }
1023:   | c=case cs=cases { c::cs }
1024:   | c=case semicolon cs=cases { c::cs }
```

moc **1.16.1** (`parser.mly:821`, `826`) had no `cases` rule; `;` was a **required
separator** between arms:

```
821:   | TRY e=exp_nest LCURLY cs=seplist(case, semicolon) RCURLY
826:   | SWITCH e=exp_nullary(ob) LCURLY cs=seplist(case, semicolon) RCURLY
```

`seplist(case, semicolon)` in 1.16.1 has no empty tail _between_ items: to place a
second arm you must consume the `SEP` arm (381). So on **1.16.1 the `;` after every
non-final arm was grammatically required** — for braced and bare arms alike. The
change is commit `fdbeecb6d3` (#6358, 2026-09-17, ancestor of base); its message:
"**P2** — the `;` between `switch` cases is optional (every case starts with the `case`
keyword, so it disambiguated nothing)."

**What this establishes:**

- **Sub-claim (a) CONFIRMED for moc2 / base+head, by grammar.** In `cases` (1024) the
  `semicolon` is optional before the next `case`, so a braced (or bare) arm may be
  followed directly by `case`. `moc2` dropping the `;` after a braced arm is sound on
  the grammar it targets.
- **Sub-claim (b) CONFIRMED as a reason, by grammar.** On **1.16.1** the `SEP` was
  mandatory between _any_ two arms, bare or braced (821/826). So `preserve` keeping the
  `;` is correct-conservative for 1.x **and** for bare arms.
- **The plan's specific reason is imprecise, and the imprecision is what makes the
  asymmetry safe.** The plan says `preserve` keeps the `;` "because moc 1.x needs it
  after a **bare** arm". Reading 1.16.1 literally, 1.x needed it after **every** arm —
  braced included. Framed the plan's way (only bare arms need it) a reader might
  conclude `preserve` could drop the `;` after a _braced_ arm on 1.x. The grammar says
  it may not. **`preserve` must keep the `;` after every non-final arm, braced or bare,
  when the output must be 1.x-parseable** — which is exactly what "preserve" does.

**Could not verify without moc.** Whether 1.16.1 _in practice_ accepts a braced arm
followed by another `case` without `;` (via error recovery rather than the grammar) is
**unverified** — no `moc` binary here. Reading `src/mo_frontend/parsing.ml` at `1.16.1`
shows a `MenhirRecoveryLib` recovery config whose insertion guide is
`let guide _ = false` and `let use_indentation_heuristic = false`; that config does not
obviously insert a `;` to bridge a missing separator, but recovery behaviour is exactly
the kind of thing that must be _executed_ to be sure. Treat "1.x rejects an arm missing
its `;`" as grammar-implied, not proven.

**Corpus statistic (corroboration only).** Across moc 1.16.1's `test/` tree there are
**909** occurrences of a braced arm (`}`) immediately followed by `case` **with** an
intervening `;`, and **0** without. (Measured by stripping line comments and using a
word-boundary `case` match to avoid the false positives inside comments/strings such as
`case null {} /* … case. */;` and `"openid:https://…"`.) This is consistent with "1.x
needs the `;`" but does not prove acceptance — a corpus can simply never have exercised
the other spelling.

**At which level are the two spellings "equal"?** §3 above and `preserve`'s runtime guard
answer this differently, and both are right — they compare different things. Measured
(`.probe/_switchsemi5.mts`, `.probe/_switchsemi6.mts`) on both the braced and the bare pair:

| level                                | braced pair      | bare pair        |
| ------------------------------------ | ---------------- | ---------------- |
| named nodes (`case`, `block_exp`, …) | 19 vs 19 — equal | 15 vs 15 — equal |
| anonymous tokens                     | 10 vs 9 — differ | 6 vs 5 — differ  |

So "the tree" is equal and "the token stream" is not, with the entire difference being
the one `;`. Dropping it is therefore semantically inert in the moc sense **and** a real
change to the token stream. This matters because **`preserve`'s guard works at the token
level** (`verify.ts` compares `shapeOf`, whose leaves include anonymous tokens): it cannot
implement `moc2`'s drop, which is why that drop is a `moc2`-only edit and why the guard is
told about it there rather than tolerating it here.

**tree-sitter is more permissive than moc 1.16.1 here.** Probe case
`case-semi-fully-optional-in-ts` shows tree-sitter 0.2.0 accepts two **bare** arms with
**no** `;` between them and normalises the tree equal to the `;`-present spelling
(grammar.js: `switch_exp: seq("switch", …, "{", repeat(seq($.case, optional(";"))), "}")`).
That is a tree-sitter-side fact and must **not** be read as "moc 1.x accepts it". For
`case` arms, the probe is an oracle for "did the tree change", not for moc 1.x legality —
which is why the printer's rule here comes from the grammar (§3), not from the probe.

**Verdict: CONFIRMED for `moc2` (a) and for `preserve` (b) as a conservative rule;
the plan's _stated reason_ for (b) is narrower than the grammar and should not be used
to justify dropping `;` after a braced arm on 1.x.**

---

## 4. Does `semi: false` change meaning?

**Claim (plan, line 91).** "`semi: false` drops the trailing `;` in broken blocks too."

**Preconditions.** `semi: false` is safe **iff** it only ever removes the separator
after the **last** item of a `seplist`/`seplist1` (§1). It is unsafe the instant it
removes an **interior** one.

**Evidence — probe, the negative control that names the hazard.**

```
NEG-semi-false-interior-drop   DIFFERS-SILENT (as expected: parses as something else, no ERROR!)   [semis: 1, 0]
    NEGATIVE CONTROL for `semi:false`: dropping an INTERIOR separator is NOT inert
    (so `semi:false` must only ever drop the LAST item separator)
semi-false-last-item-only      IDENTICAL (normalised tree ignores the `;`)                          [semis: 1, 2]
    semi:false correctness precondition -- dropping the LAST item separator is inert;
    dropping an INTERIOR one is not (see NEG cases). Both spellings of the last item agree.
```

`NEG-semi-false-interior-drop` is `func f() { a; b }` → `func f() { a b }`. The tree
does not error: `a b` re-glues into an **application** (`call_exp_object`), so the
program silently changes meaning. **No ERROR node is produced.** This is the failure
mode to guard against. Two more silent-reparse cases were found:

```
ADV-brace-stmt-then-paren-stmt   DIFFERS-SILENT   [semis: 1, 0]
    ADVERSARIAL: a `}`-ending statement followed by a `(`-starting statement NEEDS its `;`,
    or it re-glues as application
```

`func f() : Nat { let x = 1; (x, 2).0 }` → dropping the `;` yields
`let x = 1 (x,2).0` — the `let` initialiser becomes `1 (x,2).0` (a call), again with
**no ERROR**. Contrast the cases that _do_ error (missing token inserted by tree-sitter
recovery, `hasError` true), which are the _safe_ failure mode because they are loud:

```
ADV-brace-stmt-then-bracket-stmt DIFFERS-ERROR  (two `}`-ending statements back to back)
NEG-block-interior-semi          DIFFERS-ERROR  (interior block separator)
NEG-record-interior-semi         DIFFERS-ERROR  (interior record separator)
```

and, proving the grammar has no empty-item arm (§1):

```
EDGE-double-semi-block           DIFFERS-ERROR   `{ a;; b }` is not `{ a; b }`
EDGE-lone-semi-block             DIFFERS-ERROR   `{ ; }` is not the empty block
```

**Verdict: `semi: false` is SAFE only under an explicit precondition**, confirmed by the
negative control above:

> **`semi: false` may drop the `;` after the _last_ item of a block/record/type body,
> and must never alter any interior separator or the separator between two statements**
> (including the `}`-then-`(` / `}`-then-`}` pairs of the plan's `if c { … };` example,
> where the `;` is interior to the enclosing `seplist(dec, semicolon)`).

When the printer emits `ifBreak(";")` for the **last** statement of a block, `semi:false`
suppressing it is inert (§1). When it emits a `;` **between** statements, `semi:false`
must not touch it. The plan's phrasing ("drops the trailing `;` in broken blocks too")
is correct **only if "trailing" means the last statement's separator**; read as "the
separator before `}`", it is correct; read as "any `;` at a line end", it is wrong
(`NEG-semi-false-interior-drop`).

**Loudness is not a substitute for correctness.** Note that `EDGE-double-semi-block`
etc. fail _loudly_ (ERROR), while the two dangerous cases fail _silently_. The runtime
guard in `src/parser/verify.ts` (normalised re-parse; forgives only a logged `;` drop)
is the right backstop, but the printer's rule must be right first: a `;` must be dropped
**only** at the tail, and only when the tail is genuinely the last item.

---

## 5. Supporting evidence: the style guide and the reference grammar

`motoko` style guide at head `1d57a4fc`, `doc/md/reference/style-guide.md`
("Punctuation / Semicolons"):

> Put a semicolon after the last expression in a block, unless the whole block is
> written on a single line. Similarly for types.

> // No `;` between the arms of a switch: `case` already ends the previous arm

and, under "Braces", the legacy forms still accepted: a bare branch after a single-atom
head (`if (v >= 0) v else -v`), a bare `case` body (`case null 0`), and an expression
function body. At **1.16.1** the same section said "`// End last case with ;`" — i.e. the
1.x style guide _endorsed_ the `;` after the last arm, matching §3(b). The two style
guides differ at exactly the point the two grammars do.

Note the style guide's one-line exception is the human-facing statement of the
`ifBreak(";")` rule of §2, and this is why the plan calls the trailing `;` a
formatting choice rather than a semantic one.

---

## 6. The probe: methodology and raw output

**File.** `.probe/semi-parse.mjs` (uses the shared `.probe/lib.mjs`, loads
tree-sitter-motoko 0.2.0 from `.probe/tree-sitter-motoko.wasm` — the sha256 in the
header above, **not** the stale checkout).

**Method.** For each named case, a list of snippet _variants_ that differ only in
semicolons is parsed, and two comparisons are made:

- `norm` — the tree with every anonymous `;` leaf erased; two variants are
  **identical** iff their `norm` strings match.
- `raw` + a `;`-leaf count, plus `hasError`/missing-token detection.

Verdicts: `IDENTICAL` (normalised tree ignores the `;`), `DIFFERS-SILENT` (tree differs,
**no** error → the source parses as something else — the dangerous class),
`DIFFERS-ERROR` (tree differs with an error/missing token → loud). Cases carry
`expectDifference` (adversarial/negative controls that _should_ differ) and
`expectSameSemiCount` (empty-vs-empty cases with nothing to differ), so a
`SAME` result on a negative control is reported as a **failure**. A vacuity guard warns
when an `IDENTICAL` verdict rests on variants that had no `;` difference at all — the
final run emits no such warning.

**Run.** `node .probe/semi-parse.mjs` (add `--dump <name>` for full trees, used above).

**Raw output (tail — summary and the decisive cases verbatim):**

```
NEG-semi-false-interior-drop      DIFFERS-SILENT (as expected: parses as something else, no ERROR!)   [semis: 1, 0]
EDGE-double-semi-block            DIFFERS-ERROR (as expected for a negative control)   [semis: 1, 2]
EDGE-lone-semi-block              DIFFERS-ERROR (as expected for a negative control)   [semis: 0, 1]
EDGE-empty-block-both             IDENTICAL (normalised tree ignores the `;`)   [semis: 0, 0]
semi-false-last-item-only         IDENTICAL (normalised tree ignores the `;`)   [semis: 1, 2]
ADV-brace-stmt-then-paren-stmt    DIFFERS-SILENT (as expected: parses as something else, no ERROR!)   [semis: 1, 0]
ADV-brace-stmt-then-bracket-stmt  DIFFERS-ERROR (as expected for a negative control)   [semis: 1, 0]
ADV-broken-record-trailing-semi   IDENTICAL (normalised tree ignores the `;`)   [semis: 2, 1]
ADV-broken-variant-trailing-semi  IDENTICAL (normalised tree ignores the `;`)   [semis: 2, 1]
NEG-record-sep-is-comma-not-semi  DIFFERS-ERROR (as expected for a negative control)   [semis: 1, 0]
NEG-block-interior-semi           DIFFERS-ERROR (as expected for a negative control)   [semis: 1, 0]
NEG-record-interior-semi          DIFFERS-ERROR (as expected for a negative control)   [semis: 1, 0]

----------------------------------------------------------------------------------------------------------------------
cases: 43  identical: 32  unexpected differences: 0  expected differences: 11  failures: 0
note: `;`-relevance here means tree shape under the
      tree-sitter-motoko 0.2.0 grammar, NOT semantic equivalence under moc.
```

Exit code 0. `head` of the same run includes the per-construct `IDENTICAL` rows cited in
§2: `block-trailing-semi`, `record-literal-trailing`, `object-type-trailing`,
`variant-type-trailing`, `module-body-trailing`, `actor-body-trailing`,
`top-level-trailing`, `case-braced-sep-present`, `case-last-arm-semi`, `imports-trailing`,
`object-exp-trailing`, `class-body-trailing`, `pattern-record-trailing`, and both
`ifbreak-*` cases.

**Decisive trees (verbatim `--dump`), showing silent vs loud:**

```
NEG-semi-false-interior-drop  variant 1: "func f() { a b }"
  no ERRORS -- `a b` parses as (call_exp_object (var_exp a) (var_exp b))

ADV-brace-stmt-then-paren-stmt  variant 1: "…let x = 1  (x, 2).0…"
  no ERRORS -- the initialiser becomes (call_exp_object (lit_exp 1) (par_exp …))

ADV-brace-stmt-then-bracket-stmt  variant 1: two `}`-statements, no separator
  ERRORS: [{"type":";","missing":true,...,"text":""}]   <- loud: tree-sitter inserts a missing `;`
```

---

## Reviewer checklist

1. **`semi: false` precondition (§4).** Verify the implementation drops only the
   _last_ item's separator. The two `DIFFERS-SILENT` probe cases are the regression
   tests to add: `func f() { a; b }`-shaped and `}`-then-`(`-shaped drops must never be
   emitted.
2. **`preserve` after a braced arm (§3).** The plan's stated reason ("moc 1.x needs it
   after a **bare** arm") is narrower than the 1.16.1 grammar, which required the `;`
   between **all** arms. Confirm `preserve` keeps the `;` after braced arms too — or
   confirm the output is never claimed to be 1.x-parseable.
3. **The `case`-arm rule rests on grammar, not on the probe (§3, §7).** tree-sitter
   accepts bare arms with no `;`; moc 1.16.1's grammar did not. Do not let a green probe
   be used to justify emitting something moc 1.x rejects.
4. **The unverified item (§3).** Whether 1.16.1 _in practice_ error-recovers a missing
   arm separator was not executed. If a `moc` 1.x binary is available to a reviewer, run
   `moc -c` on a switch with two braced arms and no `;` to close this gap.

## What could NOT be verified (plainly)

- **No moc execution of any kind.** No `moc` binary, `moc.js`, or OCaml toolchain in
  this environment. All moc-side claims are grammar-reading, corpus statistics, or
  precedent.
- **1.16.1's exact acceptance of a braced arm without `;`** — grammar-implied to be a
  syntax error, but not executed; error recovery in `parsing.ml` at 1.16.1 was read but
  not exercised.
- **Semantic equivalence under moc** (inference, type-checking) is out of scope: the
  probe and the grammar rules show _parse_ equivalence, which is what the printer must
  preserve.
- The probe's `IDENTICAL`/`DIFFERS-*` verdicts are under **tree-sitter 0.2.0**, an
  independent second grammar. They are strong evidence for "the tree did not change" and
  are not, by themselves, evidence about moc 1.x.
