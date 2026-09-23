# Whitespace adjacency specification

**Status:** empirical, derived by probe. Every row below was produced by running an
actual parser, not recalled from memory. The instruments are listed in
[§1.4](#14-instruments) and every claim carries the command that produced it and the
observed result.

**Audience:** the implementer of `src/printer/adjacency.ts` (see
`docs/formatter-rework.md`). This document is meant to be sufficient on its own: an
implementer should never have to re-derive a seam.

---

## 0. The invariant

The plan states it verbatim:

> **preserve**: output means the same under BOTH moc 1.x and moc 2.0 lexing.

Unpacked, that is a conjunction over three parsers, not one:

1. **moc 2.0** (`Motoko compiler 2.0.0-beta.1`) must read the printed text the same
   way it read the input.
2. **moc 1.x** must read it the same way. "1.x" is a _range_, not a point — see
   [§1.3](#13-what-1x-actually-means). The operative fact is that the 1.x lexer is
   **byte-identical from 1.1.0 through 1.16.1** and never emits a `TIGHT_*` token.
3. **tree-sitter-motoko 0.2.0** — the parser the formatter itself is built on —
   must produce the tree the printer intended. Where tree-sitter is _more_ permissive
   than moc (it is, in three places, listed in [§5](#5-tree-sitter-vs-moc-deviations))
   the printer's own output can be self-consistent while being wrong for moc. Those
   rows are called out explicitly.

Because the three parsers disagree **in both directions**, the cross-generation-safe
spelling is frequently **neither** natural spelling. The printer's job is not "match
one lexer" — it is "emit a spelling all three accept with the intended structure."
Where no such spelling exists without adding parentheses, **the printer adds
parentheses**; it does not choose a side.

### 0.1 The three forcing verbs

Each token pair gets exactly one of:

| verb             | meaning                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **force-glued**  | no whitespace/comment may appear between the two tokens in the output. A comment between them is a _break_, not a glue (comments are handled by [§4](#4-comment-seams)). |
| **force-spaced** | at least one whitespace character (space/newline/tab/CR) must appear.                                                                                                    |
| **free-spaced**  | any of glued / spaced / newline parses identically; the printer may choose by layout.                                                                                    |
| **paren-wrap**   | no bare spelling is safe on all three parsers; the printer must emit the whole sub-expression in parentheses and then apply the inner row.                               |

and is annotated with **which lexer requires it**: `ts` (tree-sitter),
`1x` (moc 1.x lexer), `2x` (moc 2.0 lexer). A row may be required by more than one.

---

## 1. Method and instruments

### 1.1 The empirical rule

Every pair below was fed to each instrument in both (and, for the three-way seams,
all) spellings. The verdict recorded is the one that matters for a printer:

- **tree-sitter** — parse the two spellings, normalise the tree to a token/field
  string (`lib.mjs` / `probe3.mjs`), and compare. `SAME` ⇒ tree-sitter does not care.
  `DIFFERENT` ⇒ the trees differ. `A-ERROR`/`B-ERROR` ⇒ exactly one spelling parsed.
- **moc** — `moc --check <file>` and classify the diagnostic:
  `syntax error` → **SYNTAX**, any other `error` → **TYPE** (parsed, failed later —
  e.g. unbound variable, which is the _success_ case for a spacing probe), no error
  → **OK**. `-dp` was used where an actual tree dump was needed.

A spelling that is SYNTAX under compiler X but parses under compiler Y (TYPE or OK)
is the proof of a lexer-generation difference. Everything in the normative tables is
of that form or its absence.

### 1.2 Which tree-sitter wasm

The wasm committed in the `/Users/kamil.listopad/tree-sitter-motoko` checkout is
**stale (pre-PR#25) and cannot parse unparenthesised moc2 heads**. The wasm used here
is the current one:

```
shasum -a 256 .probe/tree-sitter-motoko.wasm
35e710b01a8fc67fe9d34cec8b67b1528d5d3c114ec4cf121f03dd5c9632fbf9
```

`tree-sitter-motoko` at tag `77597da chore: release 0.2.0 (#30)`; `web-tree-sitter`
0.26.13; Node v26.5.0. `.probe/tree-sitter-motoko-STALE.wasm` is retained only as
the negative control (used by `deviation-stale-wasm.mjs`).

### 1.3 What "1.x" actually means

The task text says to preserve meaning under "moc 1.x and moc 2.0". This is a range
and the boundary is load-bearing, so it is stated precisely:

- `src/mo_frontend/lexer.ml` is **byte-identical between tags 1.1.0 and 1.16.1**
  (3128 bytes each; `diff` clean). `grep -c TIGHT` = 0 and `grep -c NULLCOALESCE` = 0
  in both. So all of moc 1.x has the same whitespace rules for the seams that existed
  in 1.1.0.
- **`??` does not exist before 1.7.0.** `| "??" { NULLCOALESCE }` is present in
  `source_lexer.mll` at tag 1.7.0 and 1.16.1 and **absent** at 1.1.0. Every bundled
  `dfx` moc binary (0.13.7 → 1.1.0) rejects `a ?? b` as SYNTAX.
- The newest _true_ 1.x binary runnable in this environment is **1.1.0**
  (`~/.cache/dfinity/versions/0.31.0/moc`), so "1.x accepts `a ?? b`" could **not**
  be verified against a released 1.7.0+ tarball. It was verified against the
  PR-#6385-pinned build (`/tmp/moc6385/.../moc.exe`, `1.16.1-26-g1d57a4fc7b`, which
  `git describe`s as `2.0.0-beta.1-12-g1d57a4fc7b`) — a 1.16.1-era lexer. Treat
  "1.x-OK" for `??` rows as _1.7.0-and-later-OK_, and note that ≤1.6.0 would be SYNTAX.
  See [§6](#6-unverified-and-surprising).

### 1.4 Instruments

| instrument                    | path                                           | version string                                     |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| moc 1.x (oldest runnable)     | `~/.cache/dfinity/versions/0.31.0/moc`         | `Motoko compiler 1.1.0 (source q8nbql1z-…)`        |
| moc 1.16.1-era (PR #6385 pin) | `/tmp/moc6385/src/_build/default/exes/moc.exe` | `Motoko compiler (source 1.16.1-26-g1d57a4fc7b)`   |
| moc 2.0                       | `/tmp/mocnow/moc`                              | `Motoko compiler 2.0.0-beta.1 (source cm629575-…)` |
| tree-sitter                   | `.probe/tree-sitter-motoko.wasm`               | tree-sitter-motoko 0.2.0 (sha above)               |

> **Discrepancy, disclosed.** The task text asserts "There is NO moc binary and no
> moc.js in this environment." **This is false for this environment.** Three real moc
> executables were found and used; every moc-backed claim in this document is from
> running them, and the exact invocations are given. Per the honesty rule, moc-backed
> rows are labelled as verified, not scaffolded. If a reviewer's environment truly has
> no moc, the tree-sitter column alone still decides every row whose verdict is
> tree-sitter-`DIFFERENT` or `ERROR`; the moc columns are the cross-check.

**Probe scripts** (all retained under `.probe/`, all mine): `moc-matrix.sh`,
`moc-matrix2.sh` (two/three-compiler `--check` matrices), `probe3.mjs` (124-case
glued-vs-spaced sweep), `probe4.mjs` (30-case supplementary sweep), `probe5.mjs`–
`probe8.mjs` (shifts/case-tags/type-args, `<`/`>`, `??`/`#`, juxtaposition &
moc-`-dp` diffs), `probe9.mjs`, `lib.mjs` (shared harness), plus the
`deviation-*.mjs` set. Reproduce with:

```
bash .probe/moc-matrix.sh
bash .probe/moc-matrix2.sh
node .probe/probe3.mjs | tail -1
node .probe/probe4.mjs | tail -1
```

---

## 2. Normative table — the mandatory rows

Grouped by **direction of disagreement**, because that is what determines the safe
spelling. Read the "safe emission" column as the printer's contract.

### 2.1 Heads (`if`/`while`/`switch`/`for`) of compound expressions

This is the single largest family. The rule changed _between_ 1.1.0 and 1.16.1.

| #   | pair                                                    | safe emission                                 | verb        | required by                                                               |
| --- | ------------------------------------------------------- | --------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| H1  | head is a **call** `f(x)` / `f (x)`                     | **paren-wrap the condition**: `if (f(x)) { }` | paren-wrap  | `1x` rejects both bare spellings                                          |
| H2  | head is an **index** `xs[i]` / `xs [i]`                 | **paren-wrap**: `if (xs[i]) { }`              | paren-wrap  | `1x` rejects both bare spellings                                          |
| H3  | head is an **instantiated call** `f<T>(x)` / `f<T> (x)` | **paren-wrap**: `if (f<T>(x)) { }`            | paren-wrap  | `1x` rejects both                                                         |
| H4  | head is a **compound operator application** `n - 1 > 0` | **paren-wrap**: `if (n - 1 > 0) { }`          | paren-wrap  | `1x` rejects the tight form; see [§3.2](#32-deviation-2--if-c--h--else-5) |
| H5  | head is a **bare name** `c`                             | `if c { }` or `if (c) { }`                    | free-spaced | —                                                                         |
| H6  | head is a **parenthesised** condition `(c)`             | `if (c) { }`                                  | free-spaced | —                                                                         |
| H7  | head is a **projection/`<`-free atom**                  | any                                           | free-spaced | —                                                                         |
| H8  | `switch` / `while` / `for` heads                        | same rules H1–H7 with the same keyword        | paren-wrap  | `1x`                                                                      |

**H1–H4 are the core safety finding.** The "tight head" style the compiler style
guide mandates (`f(x)`, `xs[i]`, `n - 1`) is a **1.7.0+/2.0-era rule**; on 1.1.0 both
the tight and the spaced bare forms are SYNTAX and only the parenthesised form parses.
The printer cannot know which moc will consume its output, so it must emit the
parenthesised form. `if (f(x)) { 1 } else { 2 }` is TYPE (i.e. parses) on **all
three** compilers; `if f(x) { … }` is SYNTAX on 1.1.0.

**When the head is already atomic (H5–H7), it stays bare** — forcing parentheses onto
`if c { }` would be a gratuitous change, and `if c { }` is OK on all three.

Evidence:

```
bash .probe/moc-matrix.sh    # head-call-tight / head-index-tight / head-inst-call-*
#   OLD=1.1.0 SYNTAX   NEW=2.0.0-beta.1 TYPE      <-- LEXER DIFFERENCE
#   head-if-par, head-switch-par, head-while-par all TYPE on all three
```

Three-compiler closure (from the matrix in §7 of the session record):

```
head-if-call-tight     SYNTAX  TYPE    TYPE
head-if-call-space     SYNTAX  SYNTAX  SYNTAX
head-if-par            TYPE    TYPE    TYPE     <- safe
head-if-index-tight    SYNTAX  TYPE    TYPE
head-if-index-space    SYNTAX  SYNTAX  SYNTAX
head-for-tight         SYNTAX  TYPE    TYPE
head-for-space         SYNTAX  SYNTAX  SYNTAX
head-for-par           TYPE    TYPE    TYPE     <- safe
```

### 2.2 Bare branches: `(` `[` `-` `+` `^` `#` `?` after a head

A bare branch may begin with a token that the _head_ would happily swallow. On 1.1.0
the `(` branch is a call continuation; on 1.16.1+/2.0 it is an error unless spaced.
The safe rule is again to **space the branch opener**, except where even that is
rejected (`(`/`[` — see H1/H2, which force `if (c) (e) else f;` for a _parenthesised_
head and OK on all three).

| #   | pair                                         | safe emission                                                                                                         | verb         | required by |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------ | ----------- |
| B1  | `if (c) (e) else f;` / `if (c)(e) else f;`   | **spaced**: `if (c) (e) else f;`                                                                                      | force-spaced | `1x`,`2x`   |
| B2  | `if (c) [i] else [];` / `if (c)[i] else [];` | **spaced**: `if (c) [i] else [];`                                                                                     | force-spaced | `1x`,`2x`   |
| B3  | `if (c) -1 else 2;`                          | **spaced-before-operand**: `if (c) -1 else 2;`                                                                        | force-spaced | `1x`,`2x`   |
| B4  | `if (c) - h { 1 } else { 5 };`               | branch `-h` / `- h` both leave the head unbracketed; **if a branch is needed, use a bare branch `if (c) -h else 5;`** | see §3.2     | —           |
| B5  | `if (c) #less else #greater;` / `#ok(1)`     | **spaced before `#`**: `if (c) #less …`, `if (c) #ok(1) …`                                                            | force-spaced | `1x`,`2x`   |
| B6  | `?x` after a head                            | **force-glued**: `?` binds its operand                                                                                | force-glued  | `1x`,`2x`   |

Note the asymmetry the probes made visible:

```
bare-par-tight    TYPE  SYNTAX  SYNTAX    if (c)(e) else f;
bare-par-space    TYPE  TYPE    TYPE      if (c) (e) else f;     <- safe
bare-brk-tight    TYPE  SYNTAX  SYNTAX    if (c)[i] else [];
bare-brk-space    TYPE  TYPE    TYPE      if (c) [i] else [];    <- safe
br-neg-tight      OK    SYNTAX  SYNTAX    if (c)-1 else 2;
br-neg-lead       OK    OK      OK        if (c) -1 else 2;      <- only universally safe
br-neg-space      OK    SYNTAX  SYNTAX    if (c) - 1 else 2;
br-hash-tight     OK    SYNTAX  SYNTAX    if (c)#less else #greater;
br-hash-space     OK    OK      OK        if (c) #less else #greater;   <- safe
br-hash-payload   OK    SYNTAX  SYNTAX    if (c)#ok(1) else #err;
br-hash-payload-sp OK   OK      OK        if (c) #ok(1) else #err;      <- safe
```

The `-` row (**B3**) is the sharpest result in this document: of the four spellings
`-1` glued, ` -1` lead-space, ` - 1` spaced, only **` -1`** (space before, glued to
operand) parses on all three. `-1` glued to the `)` and ` - 1` both fail on 1.16.1+.

### 2.3 `<` : instantiation vs comparison

| #   | pair                                    | safe emission                                         | verb                           | required by                          |
| --- | --------------------------------------- | ----------------------------------------------------- | ------------------------------ | ------------------------------------ |
| L1  | `f<Nat>(1)` instantiation               | **force-glued**: `f<Nat>(1)`                          | force-glued (both `<` and `>`) | `ts` (misreads spaced as comparison) |
| L2  | `List<Nat>` type arguments              | **force-glued**: `List<Nat>`                          | force-glued                    | `ts`                                 |
| L3  | `x < y` comparison                      | **force-spaced both sides**: `x < y`                  | force-spaced                   | `1x`,`2x`,`ts`                       |
| L4  | `x <= y`, `x >= y`, `x != y`, `x == y`  | **force-spaced both sides**                           | force-spaced                   | `1x`,`2x`                            |
| L5  | nested close `List<List<Nat>>`          | **force-glued** (no space before `>>`)                | force-glued                    | `ts`                                 |
| L6  | `mixin<system>()`, `include M<system>;` | **force-glued** both angles                           | force-glued                    | `ts`                                 |
| L7  | `type F<A <: Nat> = A;` bound           | force-glued around `<` and `>`; **space around `<:`** | mixed                          | `ts`                                 |

The lexers do not agree on how they _decide_ `<`, which is why the same source can be
read differently:

- **tree-sitter** marks the instantiating `<` as `token.immediate("<")` (`grammar.js`
  `inst` line 1088, `path_typ` line 1154), both carrying the grammar's own
  `NOTE(id: leading-ws-bug)` — a workaround for tree-sitter issue #4091. Consequence:
  a _space before_ `<` makes tree-sitter parse a comparison, so `f <Nat>(1)` and
  `f < T > (x)` are `DIFFERENT` from the glued form and `f <T>(x)` is an
  inst-vs-comparison-chain `DIFFERENT`.
- **moc (both generations)** disambiguates `<` by grammar context, not adjacency:
  `f <Nat>(1)` and `f<T>(1)` produce the _identical_ tree
  `(CallE _ (VarE (ID f)) (PathT (IdH (ID T))) (LitE (PreLit 1 Nat)))`. So the moc
  columns are OK either way; only tree-sitter cares, and the printer is tree-sitter's
  consumer, so **force-glued wins**.
- Comparison is not free: `x<y;` and `x>y;` are SYNTAX in **both** moc generations
  (the lexer only produces `LTOP`/`GTOP` when there is whitespace on both sides:
  `| Parser.GT when leading_ws () && trailing_ws () -> Parser.GTOP`). Hence L3–L4 are
  force-spaced on **both sides**, not just one.

```
node .probe/probe3.mjs | tail -1
tally {"B-ERROR":36,"SAME":69,"DIFFERENT":9,"A-ERROR":6,"BOTH-ERROR":4} 124
# l-inst DIFFERENT (inst vs comparison chain); l-cmp A-ERROR; l-cmp-lead-only A-ERROR;
# l-two-gt B-ERROR ('a > > b' does not split); l-inst-after/close/cmt SAME
```

### 2.4 `??`, `?`, `??`-as-two-options

| #   | pair                                  | safe emission                                                     | verb               | required by               |
| --- | ------------------------------------- | ----------------------------------------------------------------- | ------------------ | ------------------------- |
| C1  | `a ?? b`                              | **free-spaced before, force-spaced after**: `a ?? b` (or `a?? b`) | force-spaced after | `1x`,`2x`                 |
| C2  | `a ??b`                               | **never**                                                         | —                  | `1x`,`2x`,`ts` all SYNTAX |
| C3  | `a??b`                                | **never**                                                         | —                  | `1x`,`2x`,`ts` all SYNTAX |
| C4  | `a ??\nb`, `a ??\rb`                  | **never** — only space and tab are inside the token               | —                  | `2x`                      |
| C5  | `opt ?? { x = 0 }`, `opt ?? do { x }` | space after `??`, then the record/`do`                            | force-spaced       | `2x`                      |
| C6  | two option tokens `? ?a`              | **force-spaced**: `? ?a`                                          | force-spaced       | `1x`,`2x`                 |
| C7  | `?? a` meaning `?` applied to `?a`    | **never**                                                         | —                  | `1x` OK / `2x` SYNTAX     |

The `??` token is `alias(token(/\?\?[ \t\r\n]/), "??")` — **the trailing whitespace is
part of the token**, and `\f`/`\v` are _not_ in the class (`probe7`: `a ??\fb;` and
`a ??\u000bb;` are tree-sitter ERRORs). So C4 is not a style preference; a newline
after `??` changes the token. moc 2.0's lexer splits `NULLCOALESCE` into two `QUEST`s
when there is no trailing whitespace — which is exactly why C2/C3 are SYNTAX there.

C7 is the 1.x-vs-2.0 divergence: `let c = ?? a;` is OK on 1.1.0 but SYNTAX on
1.16.1/2.0, because 2.0 reads glued `??` as two `?` tokens and rejects
option-of-option-without-space. `let c = ? ? a;` is OK on all three.

```
quest2-tight   OK      SYNTAX  SYNTAX    let c = ?? a;
quest2-spaced  OK      OK      OK        let c = ? ? a;     <- safe
coalesce-spaced  SYNTAX  OK    OK        a ?? b;
coalesce-lead    SYNTAX  OK    OK        a?? b;
coalesce-trail   SYNTAX  SYNTAX SYNTAX   a ??b;
coalesce-glued   SYNTAX  SYNTAX SYNTAX   a??b;
coalesce-nl-after SYNTAX SYNTAX SYNTAX   a ??\nb;
```

### 2.5 `.` and the number-dot rule

| #   | pair          | safe emission                                                              | verb        | required by                                           |
| --- | ------------- | -------------------------------------------------------------------------- | ----------- | ----------------------------------------------------- |
| D1  | `5.toText()`  | **force-glued**: `5.toText()`                                              | force-glued | none of the three (both spellings OK) — but see D2/D3 |
| D2  | `5. toText()` | **never** — moc reads this as a **Float** `5.` applied to `toText` (M0097) | —           | `1x`,`2x`                                             |
| D3  | `5 .toText()` | free-spaced (moc reads it identically to D1)                               | free-spaced | —                                                     |
| D4  | `x.toText()`  | **force-glued** the `.` to both sides                                      | force-glued | `ts`                                                  |

`_num_dot: /[0-9][0-9_]*\./` — in tree-sitter, `5.toText` is
`(dot_exp (lit_exp (int_literal "5.")) (identifier "toText"))` with **no `.` token at
all**, whereas `5 .toText()` is a field access _with_ a `.` token. So D1 vs D3 is
tree-sitter-`DIFFERENT` while moc reads them the same. D2 is the dangerous one:

```
moc -dp '5. toText();'   # both 1.1.0 and 2.0:
(CallE _ (CallE _ (LitE (PreLit 5. Float)) (VarE (ID toText))) (TupE))   + warning [M0097]
```

i.e. a real meaning change (`5.` becomes a Float literal, `toText` becomes its callee).
tree-sitter, however, **silently reads `5. toText()` as field access** (deviation,
[§5](#5-tree-sitter-vs-moc-deviations)) — the printer's own parser will not warn it.
The printer must therefore **force-glue the number-dot form** (D1) and must never emit
D2. `5 .toText()` (D3) is safe but is not the form to emit; emit D1 for stability.

```
d-num-dot        DIFFERENT   (`.` token present/absent)
d-num-dot-after  SAME        (tree-sitter silently = field access  <-- deviation)
```

### 2.6 `#` tag / concatenation

| #   | pair                                | safe emission                                                 | verb         | required by                   |
| --- | ----------------------------------- | ------------------------------------------------------------- | ------------ | ----------------------------- |
| P1  | `#tag` at the head of an expression | **force-glued `#` to its tag**, force-spaced _before_ the `#` | mixed        | `1x`,`2x`                     |
| P2  | `a # b` concatenation               | **force-spaced both sides**                                   | force-spaced | `ts`(+`2x` for the head case) |
| P3  | `case #a { }`, `case #a(y) { }`     | force-glued `#a`, space before the payload `(`                | force-glued  | `ts`                          |
| P4  | `{ #a }` variant type               | force-glued `#a`                                              | force-glued  | `ts`                          |

moc 2.0's lexer has a `TIGHT_HASH` rule (`not trailing_ws && next is ID &&
(leading_ws || not (ends_exp prev))`), so `#less` glued to its tag is required while
the seam _before_ `#` is what changes meaning. The probes show `if (c)#less else
#greater;` is OK on 1.1.0 and SYNTAX on 1.16.1+/2.0, while `if (c) #less else
#greater;` is OK on all three — so B5/P1's "space before `#`" is the cross-generation
rule. tree-sitter is **blind** to the entire `TIGHT_HASH` seam (`h-paren-head`,
`h-stmt`, `h-case`, `h-type` all `SAME`), so it cannot be relied upon here; the moc
columns are the authority.

```
hash-branch-glued  OK  SYNTAX  SYNTAX   if (c)#less else #greater;
hash-tag-payload   OK  SYNTAX  SYNTAX   if (c)#ok(1) else #err;
head-hash-tight    OK  SYNTAX  SYNTAX   if c#less else #greater;
head-hash-name     OK  OK      OK       if c #less else #greater;   <- safe
```

### 2.7 Operators that must never be split

All **force-glued**, verified SYNTAX when a space is inserted in the middle, on
**both** moc generations (and tree-sitter, where it matters):

`:=` `+=` `-=` `*=` `/=` `%=` `#=` `**=` `+%=` `-%=` `|=` `&=` `^=` `<<=` `>>=` `<<>=`
`<>>=` (assignments); `|>` (pipe); `**` (pow); `+%` `-%` `*%` (wrapping); `->`
(arrow/function type); `await*` `async*` `await?`; `<<` `>>` `<<>` `<>>` (shift/rotate);
`0x…` hex; `1e5` exponent; `notx` (keyword-glued identifier); `_x` (underscore
identifier).

```
m-assign-split     B-ERROR     a : = b;
m-plusassign-split B-ERROR     a + = b;
m-catassign-split  B-ERROR     a # = b;
m-pipe-split       B-ERROR     a | > f;
m-pow-split        B-ERROR     a * * b;
m-wrapadd-split    B-ERROR     a + % b;
m-arrow-split      B-ERROR     Nat - > Nat;
m-awaitstar        B-ERROR     await * f();
m-underscore-id    B-ERROR     let _ x = 1;
m-comment-open     B-ERROR     a / * b;
```

Two of these are subtler than "inserting a space": `a >> b` vs `a > > b` — two `>`
tokens do **not** re-lex to a shift (tree-sitter `B-ERROR`; moc wants `SHROP` produced
from a single `>>` with leading whitespace and a following `>`). And the shift/rotate
operators are **free-spaced** (`a >> b` and `a>>b` both fine; `a >>b` and `a>> b` both
fine in moc) — the _gluing_ matters only for the `>` `>` pair.

```
l-shr / l-shr-tight-left / l-shr-tight-right   SAME
l-two-gt                                          B-ERROR  (a > > b)
shift-right-spaced/tight/lead-sp/trail-sp        OK on all three
```

### 2.8 Juxtaposition

| #   | pair                            | safe emission                                                         | verb         |
| --- | ------------------------------- | --------------------------------------------------------------------- | ------------ |
| J1  | `f x` (juxtaposition)           | **force-spaced**: at least one whitespace between callee and argument | force-spaced |
| J2  | `f { a = 1 }` (record argument) | force-spaced                                                          | force-spaced |
| J3  | `f x == 0` in a head            | **paren-wrap the head**; see H4                                       | paren-wrap   |

There is no glued spelling of juxtaposition, so the interesting comparison is `f x`
vs `f(x)` vs `f  x`. All are `DIFFERENT` trees (J1 vs a call; one vs two spaces is
`SAME`). The printer must not merge a juxtaposition into a call or vice versa, and must
not collapse the single required space. `f x;` is OK on all three; `f(x);` is OK on all
three; the danger is only inside a **head**, where `if f x == 0 { }` is tree-sitter
ERROR and moc-1.1.0 SYNTAX — hence H4/J3's paren-wrap.

```
node .probe/probe4.mjs | tail -1
tally {"SAME":19,"BOTH-ERROR":1,"DIFFERENT":9,"A-ERROR":1} 30
# x-juxta-vs-call / x-juxta-in-head / x-juxta-record / x-juxta-arg  all DIFFERENT
```

### 2.9 Everything else the printer must not disturb

Free-spaced (any whitespace, or none, parses identically) — safe to lay out normally:
`(`, `[`, `{` in _statement/expression_ position (only heads care); `,`; `;`;
`=`; `.`-projection on an identifier; `->`'s inner spacing (the arrow itself must stay
glued); keywords before their own syntax; comments ([§4](#4-comment-seams)).

---

## 3. The two named grammar deviations

Both are re-verified empirically below with the probes. The plan names them; the
probes confirm the exact conditions and the exact diagnostics.

### 3.1 Deviation 1 — `if g(1) -1 > 0 {}`

**The spelling `if g(1) -1 > 0 {}` (minus glued to its operand, spaced from the call)
is accepted by 1.1.0 and is a SYNTAX ERROR on 1.16.1 and 2.0.** Exact diagnostic
(2.0):

```
syntax error [M0275], unexpected token '-', expected a block { ... }: switch and do
always take a block, and so do the branches or body of if/while/for when the condition
or head is an unparenthesized compound expression (a call, index, projection, or
operator application); parenthesize it to keep bare branches — an unspaced (/[ after a
bare identifier continues the condition (if c[i] ... indexes c), a spaced one starts
the branch (if c [i] ...)
```

On 1.1.0 the same text gives `type error [M0057], unbound variable g` — it **parsed**,
as `if (g(1) - 1 > 0) { }`. The parenthesised form is unambiguous everywhere:

```
call-minus-tight   TYPE  SYNTAX  SYNTAX   if g(1) -1 > 0 {};
call-minus-spaced  TYPE  OK      OK       if g(1) - 1 > 0 {};
head-if-par        TYPE  TYPE    TYPE     if (g(1) - 1 > 0) { };   <- safe
```

**What the printer must never do:** emit an _unparenthesised, unbracketed_ compound
condition that ends in a `-`/`+`-shaped branch seam, and in particular never emit the
1.1.0-only `if g(1) -1 > 0 {}` form. If a compound condition appears, **wrap it in
parentheses** (H4). Confirmed identical trees for both spellings under tree-sitter
(`x-dev-g-call-minus` `SAME`) — tree-sitter cannot see this bug.

### 3.2 Deviation 2 — `if (c) -h { } else { 5 }`

**Neither `if (c) -h { … }` nor `if (c) - h { … }` is safe across generations, and the
"correct" spelling is the one that is _wrong_ on 1.1.0.** Exact results
(`let h = 1; if (c) -h { 1 } else { 5 };`):

```
paren-minus-tight   SYNTAX  SYNTAX  SYNTAX   if (c) -h { 1 } else { 5 };
paren-negbrace-sp   SYNTAX  TYPE    TYPE     if (c) - h { 1 } else { 5 };
paren-neg-literal   SYNTAX  SYNTAX  SYNTAX   if (c) -1 { 1 } else { 5 };
```

- On **1.1.0**, the minus is read as a _binary_ `SubOp` between the head `(c)` and the
  branch `h`, so the head becomes `(c - h)` and then `{ 1 }` is a record literal in
  expression position → `syntax error [M0001], unexpected token '}'`. This happens for
  **both** spellings `-h` and `- h` (and for `-1`).
- On **1.16.1/2.0**, the "tight" head rule makes `- h` parse (`type error [M0057],
unbound variable c`), i.e. `(BinE … (VarE c) SubOp (VarE h))`; but the glued `-h`
  is still SYNTAX.

The **only** universally accepted form is a _bare_ branch, where the branch is a real
expression rather than a block:

```
paren-negbrace-bare  OK  OK  OK   if (c) -h else 5;
br-neg-name-lead     OK  OK  OK   if (c) -h else 2;
```

which parses as `IfE (VarE c) (LitE (PreLit -1 Int)) (LitE 2)` — i.e. the `-h` is a
**negative literal in the branch**, not a subtraction.

**What the printer must never do:** emit `if (c) -h { … }` or `if (c) - h { … }`.
If the author wrote a unary minus applied to an identifier in a branch, the printer
must keep the branch **bare**, not brace it (braces turn a `-1`/`-h` branch into a
record literal and are read as subtraction on 1.1.0); and it must **force-space**
before the `-` operand per B3 (`if (c) -1 else 2;`).

---

## 4. Comment seams

A comment between two tokens is **not** whitespace for this purpose. The probes
include comment variants for the two most sensitive seams:

- `if f/*c*/(x) { }` — tree-sitter `B-ERROR` (same as a space; the `(` is no longer
  immediate).
- `if f/*c*/ (x) { }` and `if f /*c*/(x) { }` — also `B-ERROR`.
- `xs/*c*/[i]` — same class as the space case.
- `a??/*c*/b` — `c-cmt` is `BOTH-ERROR`; a comment after `??` breaks the token.

The rule the printer must follow: **a preserved comment inside a force-glued seam is a
hard conflict** — either move the comment outside the seam (before the whole
expression, or after it) or, if that is impossible, do not break the seam. Do not
emit `f /*c*/(x)`. `m-comment-open` (`a / * b;`) is `B-ERROR`: the printer must also
never insert whitespace _within_ a `/*` comment opener.

---

## 5. tree-sitter vs moc deviations

These are the places where the formatter's own parser disagrees with moc. They matter
because a printer can be self-consistent under tree-sitter and still be wrong.

| #   | deviation                                                                                                                                                                                                                                                                                                                                                | who is wrong                      | printer rule                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| S1  | `5. toText()` — tree-sitter reads field access; moc reads Float `5.` + M0097                                                                                                                                                                                                                                                                             | tree-sitter is **too permissive** | never emit D2; force-glue the number-dot (D1)                                                       |
| S2  | `if (c)[i] else [];` — tree-sitter agrees with 2.0 (ERROR) but 1.1.0 accepts; and `probe3`'s `b-branch-array` row has its glued/spaced strings swapped relative to its note, so the `B-ERROR` it prints is for the **spaced** operand, not the glued one. Re-confirmed via `probe9`: `if (c) [i] else [];` → ok; `if (c)[i] else [];` → `ERROR ERROR@3`. | probe label, not the parser       | trust the note, not the raw row: space the `[` (B2)                                                 |
| S3  | `f <T>(x)` — tree-sitter reads a comparison chain; both mocs read an instantiation                                                                                                                                                                                                                                                                       | tree-sitter is **too strict**     | force-glue `<` (L1); never emit `f <T>(x)`                                                          |
| S4  | glued `(`/`[` is head-**only** in tree-sitter; the grammar is permissive where moc is strict                                                                                                                                                                                                                                                             | tree-sitter is **too permissive** | the printer must not rely on tree-sitter to catch an illegal head call; apply H1/H2 unconditionally |
| S5  | `??`-as-two-options, `TIGHT_HASH`, `TIGHT_*OP` seams — tree-sitter is **blind** (`m-quest2` SAME, `h-*` SAME, `u-minus-*` SAME)                                                                                                                                                                                                                          | tree-sitter cannot decide         | use the moc columns in §2.3, §2.4, §2.6                                                             |

Also note `m-not-id` (`notx` vs `not x`), `m-hex`, `m-exp`, `m-exp-tight` are all
tree-sitter-`DIFFERENT`: keyword-glued identifiers and numeric literal seams are
visible to tree-sitter and must be preserved verbatim.

### 5.1 The `probe3` label-swap disclosure

`probe3.mjs`'s `b-branch-array` row lists the glued and spaced strings swapped
relative to its own note (`['b-branch-array', 'bracket', 'if (c) [i] else [];', 'if
(c)[i] else [];', 'bare branch array literal']`). Its reported `B-ERROR` is therefore
about `if (c)[i] else [];`, the _glued_ spelling — which matches the note's intent
after swapping. It is called out here so no reader mis-reads the raw row. The
`probe9.mjs` run confirms the correct reading directly.

---

## 6. Unverified and surprising

**Verified but surprising — decision a reviewer should double-check:**

- **The parenthesised head is the cross-generation safe form, not the tight head.**
  H1–H4. This contradicts the compiler style guide ("Keep the condition of an
  `if`/`while` … tight: `f(x)`, `xs[i]`, `n - 1`"), which is a 1.7.0+/2.0-era rule.
  A reviewer should confirm the product actually targets pre-1.7.0 consumers; if it
  does not, H1–H4 could be relaxed to the tight form and this document's tables
  simplified. **The printer is conservative (paren-wrap) regardless**, because the
  invariant names 1.x.
- **`-` after a head has exactly one safe spelling** (` -1`, B3) and it is _neither_
  the glued nor the fully-spaced one. This is the least intuitive row in the document.
- **`??`'s trailing whitespace is part of the token.** C4. Any layout pass that
  normalises `??` followed by a newline to `??` + space, or vice versa, is a meaning
  change.
- **`??` did not exist before moc 1.7.0.** So `a ?? b` is not "1.x-safe" in the
  strict sense; it is "1.7.0+-safe". If the invariant's "1.x" means _any_ 1.x, there is
  no safe spelling for a coalesce — the printer must either emit the 2.0 form and
  accept that ≤1.6.0 rejects it, or refuse. This is a specification ambiguity the
  plan does not resolve; flagged here.

**Unverified:**

- No released moc **1.7.0–1.16.1 tarball** was available; the 1.x column above 1.1.0 is
  the PR-#6385-pinned build, which self-describes as a 2.0 beta. The `lexer.ml`
  byte-identity argument (§1.3) is the evidence that 1.x spacing rules above 1.1.0
  equal 1.1.0's; it is strong but is _static reading_, not a compiler run.
- The `moc-matrix*.sh` `-dp` tree dumps were captured for a sample of rows
  (number-dot, instantiation, the two deviations, `await?`), not for every row.
- `docs/formatter-rework.md` also lists `src/printer/adjacency.ts` as the consumer;
  this document specifies the data, not that module's TypeScript shape.

**Provenance note:** the task text's claim that this environment has no moc binary is
false — see [§1.4](#14-instruments). All moc columns are from real runs.

---

## 7. Implementation checklist for `adjacency.ts`

1. **Head rule (H1–H4):** if an `if`/`while`/`switch`/`for` head is anything other
   than a bare name, a parenthesised expression, or a `<`-free atom, **wrap it in
   parentheses**. Do not emit the tight form.
2. **Bare-branch rule (B1–B3, B5):** after a head, force a space before `(`, `[`,
   `-`/`+`/`^` operands, and `#`. Never brace a unary-minus branch (§3.2).
3. **Angle rule (L1–L7):** force-glue `<`/`>`/`</`/`>>` in instantiation, type args,
   `mixin<…>`, `include M<…>`, and bounds; force-space comparison operators on both
   sides.
4. **Coalesce rule (C1–C7):** emit `a ?? b` (space or no space before, **space
   after**); emit `? ?a` for double option; never emit glued `??` before an operand.
5. **Number-dot rule (D1–D4):** force-glue `5.toText()`; never emit `5. toText()`.
6. **Hash rule (P1–P4):** force-glue `#tag`; force-space before a `#` that starts a
   branch; force-space `a # b` concatenation.
7. **Glued-operator set (§2.7):** treat the listed operators as indivisible tokens.
8. **Comment rule (§4):** a comment inside a force-glued seam is a conflict; move it
   out or keep the seam.
9. **tree-sitter blind spots (S1, S4, S5):** do not delegate any of the above to
   tree-sitter's own error recovery; enforce the rules with the printer's own
   adjacency pass.
