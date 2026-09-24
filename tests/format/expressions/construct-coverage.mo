/**
 * Construct coverage: fifteen legacy tests whose subject is a *spelling*, kept as inputs the printer
 * reproduces.
 *
 * ## Where this file comes from
 *
 * `docs/fixture-triage.md` §"Construct coverage — keep" names the legacy tests that exist to prove a
 * construct is reachable at all — "does this spelling parse, and does the printer keep it" — rather
 * than to pin a layout rule. The Misc group's non-paren remainder supplies the rest. The unit is the
 * construct's *own spelling*: each case below is the legacy input (or, where the legacy input was not
 * valid Motoko, the construct's real spelling) written so the snapshot records what `preserve` does
 * to it. Fifteen legacy tests, and what became of each:
 *
 * - `type bindings` → §2
 * - `anonymous functions` → §3
 * - `do ? / optional` → §4
 * - `async*` → §5.1
 * - `await*` → §5.2
 * - `function in type bindings` → §6
 * - `case with array value` → §7
 * - `tuple line breaks` → §8
 * - `optional variants` → §9
 * - `variants / text concatenation` → §10
 * - `` `with` keyword `` → §11
 * - `comma-parentheses` → §12
 * - `emoji in import statement` → §13
 * - `@ symbol` → **not ported** (§14 says why)
 * - `already formatted` (Misc) → §1, as the plain positive control
 *
 * `shared and query keywords`, `logical operators`, `pipe operator` and `null coalesce operator` are
 * in this group by triage but are already ported to `tests/format/expressions/literals-and-tokens.mo`
 * (the token fixtures), so they are deliberately **not** repeated here.
 *
 * ## The port criterion, and why twelve of these are `change`
 *
 * A case is ported when **its output is what the spec asks for**, not when the old test passes.
 * Where the legacy expectation and the spec disagree the spec wins, and the fixture is written at the
 * spec's output. For this group the disagreement is almost always the same one: the legacy suite ran
 * the old line-shaping engine, whose job was to *normalise whitespace inside a construct*, and its
 * expectations encode exactly that normalisation — `func foo<A <: Any>(x : A)`, `func() : ()`,
 * `do ? {}`, `?#abc`, `"A" # "B"`, `{ a and b with c = d }`. Every one of those cells changes the
 * printed *token stream* by re-spacing or by adding/removing a separator, and `docs/style.md` rules
 * that `preserve` may not make such a change:
 *
 * > `preserve` cannot implement those cells, and the reason is not a preference: the runtime guard
 * > compares the printed token stream against the tree the printer was given, and **a separator is a
 * > token**. So a `;` the printer adds or removes is a difference the guard must reject.
 *
 * So the fixture holds the source's own spacing, and the snapshot asserts that the printer left it
 * alone. Where the printer *does* move something, §11 and §12 adjudicate it, and each of those is a
 * bracketSpacing or group-break rule the printer owns — not a re-spacing of a token the author wrote.
 *
 * ## Measured
 *
 * One pass over the exact statements below as ONE program, plus the legacy fragments that were
 * excluded, in `.probe/_constructs.mts` (per-case columns: our parser, four mocs, output, fixed
 * point); the `#` seam is dissected tree-first in `.probe/_constructs_tree.mts`; the identity battery
 * that isolates what the printer actually moves is `.probe/_constructs_norm.mts`; and the whole file
 * as one program is re-verified by `.probe/_constructs_file.mts`. The four mocs are `1.1.0`
 * (`Motoko compiler 1.1.0 (source q8nbql1z-ylg40zah-wmfljwd6-j6bq1lwd)`), `rel1.16`
 * (`Motoko compiler 1.16.1 (source cmnnq83c-j64xzf3y-dbl9326w-qfay9xca)`), `pin`
 * (`Motoko compiler (source 1.16.1-26-g1d57a4fc7b)`) and `v2`
 * (`Motoko compiler 2.0.0-beta.1 (source cm629575-xbjnv6zp-giwd8xzr-q1bsqjv2)`).
 *
 * Result: our parser accepts the whole file, **all four mocs parse it**, and the output is a **fixed
 * point**. Of the statements below, **five move** and the rest are identity (`.probe/_constructs_ident.mts`
 * formats each statement alone to separate the two); all five are in §11 and §12 and are adjudicated
 * there — they are the record literal and the `if` head, which are the printer's own layout nodes.
 *
 * ## Every statement ends in `;`
 *
 * This file is formatted as ONE program, so two adjacent statements with nothing between them are a
 * parse error (`Missing ';'`). Several legacy inputs are bare fragments (`async* T`, `?#abc`, `#a`,
 * `@abc`) that are not programs; each appears below either inside a complete construct or at a
 * spelling a moc accepts as a program, and §14 records the ones that had to be dropped.
 */

// --- 1. `already formatted` (Misc): the positive control -------------------------------------------
//
// The legacy Misc test asserted that a file already in the printer's shape comes back unchanged. It is
// the baseline every other section is read against: if this section moves, the others are not being
// judged against a stable printer.
//
// The second import is §13's emoji case. It lives here rather than in §13 because Motoko requires
// every `import` before any other declaration — the moc rejects `let x = 1; import Prim "…";` at the
// `import` — so an import statement cannot have its own section further down. Both imports are in the
// printer's own shape (the second has the double gaps §13 is about) and both are byte-for-byte
// identity.

import Prim "mo:⛔";
import  Other  "mo:⛔";

let x = 1;
let y = 2;
let z = x + y;

// --- 2. `type bindings`: the author's angle spacing is a token gap --------------------------------
//
// The legacy expectation normalised both spellings to `func foo<A <: Any>(x : A)`. That is two
// re-spacings at once — a gap inside a type argument list, and a gap before a parameter's type — and
// neither is a layout choice `preserve` may make, because the gap belongs to the source node's
// children. Our parser accepts both spellings, all four mocs accept both, and each is identity here.
// The pair is the point: the printer tells them apart instead of collapsing them to one.

func foo<A<:Any>(x:A) {};
func foo <A <: Any>(x:A) {};

// --- 3. `anonymous functions`: an empty parameter list and an empty return type -------------------
//
// `func ():() {}` and `func <T> () {}` are the two spellings the legacy test wanted normalised to
// `func() : ()` and `func<T>()`. Both normalisations move tokens, so neither is made; the two below
// are identity on both engines' *input* but only ours keeps them. `docs/style.md`'s function-signature
// section breaks a signature like TypeScript and adds no trailing comma — it says nothing about
// inserting a space after `func`, which is what the legacy expectation was doing.

func ():() {};
func <T> () {};

// --- 4. `do ? / optional`: the `do?` seam is not re-spaced -----------------------------------------
//
// Four spellings of the same operator, and the legacy test moved only one of them (`do?{}` → `do ? {}`).
// That move inserts a space between two tokens the author glued; `preserve` reproduces the source gap
// instead. `?{}` on its own is the optional-block literal, `do ? {}` is the explicit form, and the two
// glued spellings are the same constructs without the gap. All four are identity.

?{};
do ? {};
do?{};
do? {};

// --- 5.1 `async*`: the type-level operator, and the bare spelling that is not a program -------------
//
// The legacy test's second input, `async * T`, is **SYNTAX on all four mocs** and our parser rejects
// it at `1:7` — so there is nothing to port there, and the "normalise to `async* T`" expectation is
// moot (see §14). `async* T` as a bare program *does* parse on all four, and the four statements below
// put the operator where it is actually reachable: a return type, a body containing `await*`, a type
// alias, and a `shared` function. All four are identity.

async* T;
func f5() : async* T {};
type T5 = async* Nat;
shared func f5s() : async* T {};

// --- 5.2 `await*`: same seam, same result ---------------------------------------------------------
//
// The legacy input `await * t` is **SYNTAX on all four mocs** and rejected by our parser; the valid
// spelling is glued, and it is identity both bare and in a body. Together with §5.1 this is the whole
// content of the two legacy tests once the invalid spellings are removed.

await* t;
func f5b() : async* T { await* t };

// --- 6. `function in type bindings`: a function type as a type argument ----------------------------
//
// Both legacy cases are `expectFormatted`, and both are identity. The `() -> ()` spelling inside the
// angle brackets is a function type, and its spacing is the author's; the printer does not add a
// trailing comma or a space around `->`. The third legacy spelling, `type T = <() -> (), Nat>`, is
// **SYNTAX on all four mocs** (a bare angle-bracket type is not a type expression) and is not ported.

f6<() -> (), Nat>();
f6<() -> (), () -> ()>();

// --- 7. `case with array value`: a `case` pattern with an array body ------------------------------
//
// The legacy input is the bare fragment `case (x) [x];`, which our parser accepts but which **all four
// mocs reject as SYNTAX** — a `case` clause is not a program. Porting it verbatim would bake a
// tree-sitter-only spelling into the snapshot and call it printer behaviour; that class of gap belongs
// in `docs/grammar-deviations.md`. The identical seam is exercised below inside a real `switch`, where
// all four mocs accept it, including one nested in a function and one with two array items.

switch y { case (x) [x] };
switch y { case (x) [x, x] };
func f7() { switch y { case (x) [x] } };

// --- 8. `tuple line breaks`: a tuple that does not fit is already broken ---------------------------
//
// The legacy test built a 5x20-character tuple and asserted the broken form came back unchanged; the
// tuple is over `printWidth` (80) with no hope of joining, so it is identity. It is the group's one
// hard-break control: the printer must keep the break the source has.

(
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
);

// --- 9. `optional variants`: `?` and a tag are not separated by a space the printer may add -------
//
// `?#abc` is `expectFormatted` (identity) and the legacy test normalised `? #abc` → `?#abc`. That is
// the same token-gap move as §4, in the other direction, and it is not made here. Both spellings are
// accepted by our parser and all four mocs, and both are identity; the `let` binding is the third
// spelling, in expression position.

?#abc;
? #abc;
let v9 = ?#abc;

// --- 10. `variants / text concatenation`: the `#` seam, tree-first ---------------------------------
//
// Nine legacy inputs, of which two are **SYNTAX on all four mocs** — `# "A"` and `# 5` — because a bare
// `#` with a space and no left operand is not a program; they are the tag-vs-concatenation hazard from
// `docs/adjacency.md` §2.6 and are not ported (§14). The seven that parse are below, and the section
// is the sharper half of the invariant: the legacy expectation force-spaced every tight `#` (`"A"# b`
// → `"A" # b`, `"A"#"B"` → `"A" # "B"`), and this printer does not, because the gap is a token gap.
//
// `docs/adjacency.md` §2.6 reads a tight `#` as a *variant tag* when what follows is a tag, which is
// why normalising it would change the program. `.probe/_constructs_tree.mts` measured what moc
// actually does with the same bytes, and the finding is recorded in §15: for the spellings below,
// tight `#` is read as concatenation on all four mocs, not as a tag. The printer's refusal to
// normalise is therefore conservative — safe, and not what the legacy engine did — and the fixture
// pins the refusal either way.

#a;
"A" # b;
"A" # #b;
"A"# b;
"A"#"B";
"A"# #b;
"A" #
"B";

// --- 11. `with` keyword: adjudications 1-4 --------------------------------------------------------
//
// The only section in the file where the printer moves the source, and every move is a rule it owns.
//
// The legacy test's four cases each *broke* the multi-line spellings into an indented list. None of
// them fits that shape: `{ a and b with c = d }` is a record literal the printer lays out, and
// `docs/style.md` §"Blocks, records, object types: one line vs broken" puts it on one line when it
// fits and has no hard break of its own — so the source breaks are *joined*, not reproduced, and the
// legacy multi-line expectation is not what the spec asks for.
//
// The bracket spacing is the second move: `{a and b with c = d}` → `{ a and b with c = d }`. That is
// style.md's Conflict ruling 1 (`bracketSpacing` defaults on) applied to a record literal — the same
// positive control as `tests/format/expressions/parens-heads-and-seams.mo` §"Record extension". The
// `;` separators inside `c = d; e = f;` are the author's and are kept; no trailing separator is added.
//
// The four statements below are the legacy test's own inputs, at the source spellings; the snapshot
// records the joined, re-spaced output, which is what the spec asks for. All four move: the first by
// the bracket spacing alone, the three broken ones by the join as well. Together with the broken `if`
// head in §12 these are the file's **five** moved statements (`.probe/_constructs_ident.mts`).

{a and b with c = d};
{a and b with
c = d};
{a and b with 
c = d};
{a and b with
c = d; e = f;};

// --- 12. `comma-parentheses`: adjudication 5 ------------------------------------------------------
//
// One statement, two moves against the legacy expectation. The legacy output was `if (\n  x\n) { y };`:
// it inserted a space after `if`, broke the head across three lines, and appended a `;`. The printer
// makes none of those. `if` and its head are glued (`preserve` keeps the source gap, and there is
// none); the head fits on one line with no hard break, so it is joined; and the `;` is a separator the
// source does not have, so it cannot be invented. The pair below is the joined and the broken-in-source
// spelling of the same head; both print as `if(x) { y };`.

if(x) { y };
if(
x) { y };

// --- 13. `emoji in import statement`: a multi-byte token is still one token -----------------------
//
// The legacy expectation collapsed the double spaces: `import  Prim  "mo:⛔";` → `import Prim "mo:⛔";`.
// That is a re-spacing of the source's own gaps, so it is not made; the emoji itself is the subject,
// and it survives byte for byte. The `mo:` prefix plus the emoji is the standard package locator and
// the printer never touches a string literal's text — the same rule as `literals-and-tokens.mo`'s
// multi-line-text section, on a single-line literal.
//
// The statement itself is the second import in §1: Motoko requires every `import` before any other
// declaration, so this case cannot sit in its own section below the `let`s. The legacy test's second
// half, `format('import  Prim  "mo:⛔";'.repeat(100))`, is not ported: it parses on all four mocs, which
// reject it *past* the parser as a duplicate binding (`M0017` on `rel1.16`, `pin` and `v2`; `M0051` on
// `1.1.0`), but it is the same statement 100 times over, so it adds no coverage a single import does
// not already have.

// --- 14. `@ symbol`: NOT PORTED — the spelling is not Motoko --------------------------------------
//
// The legacy test asserted `format('@abc') === '@abc\n'`. Measured: our parser **REJECTS** `@abc`,
// `let x = @f();` and `func @add_cycles<system>() {};` (all at the `@`), and **all four mocs report
// SYNTAX** on all three. `docs/grammar-deviations.md` §5 already rules on this exact gap: the
// grammar's `privileged_identifier: $ => seq("@", $.identifier)` at `grammar.js:403` is unreachable,
// and a `.mo` file containing `@` must be a **hard, reported failure** rather than a formatted result.
// `docs/fixture-triage.md` §"The refusals, measured" reaches the same verdict — `@ symbol` is a
// **delete**. There is no output to snapshot, so there is no fixture line.
//
// For the same reason `async * T` and `await * t` (§5.1, §5.2), `type T = <() -> (), Nat>` (§6),
// `# "A"` and `# 5` (§10), and the bare `case (x) [x];` (§7) do not appear: each is SYNTAX on all four
// mocs, and that class of gap belongs in `docs/grammar-deviations.md`, not in a fixture.

// --- 15. Finding, not acted on: the tight `#` is concatenation everywhere it was measured ---------
//
// The fixture above pins the printer's *refusal* to normalise a tight `#`, and `docs/adjacency.md`
// §2.6 justifies the refusal by reading a tight `#` as a variant tag. `.probe/_constructs_tree.mts`
// dumps the normalized tree for the tight spellings and finds `bin_exp_object` with `bin_op "#"` in
// every case — tree-sitter reads `"A"#"B"`, `"A"# b` and `"A"#b` as concatenation, and so do all four
// mocs (`CatOp` in `-dp`, and all four type-check the `Text` result). So for these operands the
// refusal is conservative rather than required: a printer that normalised them would not change the
// program, whereas the spec's §2.6 rule is stated for the tag case where it would. This is a finding
// about the printer's conservatism, not a bug to fix, and it is left as measured.
