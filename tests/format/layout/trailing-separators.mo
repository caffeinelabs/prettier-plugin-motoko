/**
 * Semicolons and trailing delimiters: the one rule `preserve` cannot implement as the spec table writes it.
 *
 * ## Where this file comes from
 *
 * `docs/fixture-triage.md` §"Semicolons and trailing delimiters — all **change**" — nine legacy tests,
 * every one of them `change`, because every one encodes the old engine's line-shape guessing:
 *
 * - `automatic semicolons` (+ three comment and multi-line-text variants)
 * - `no automatic semicolons before \`else\`, \`catch\`, etc.`
 * - `add trailing delimiters`, `remove trailing delimiters`
 * - `trailing semicolon after block comment`
 * - `trailing comma in square brackets`
 * - `replace delimiters`
 *
 * The triage's instruction for this group is explicit: "A fixture whose name is `automatic semicolons`
 * and whose body is a hand-enumerated table of line-shapes should be **deleted and replaced**, not
 * ported — the table is the old algorithm." So the sections below are re-derived from the rule, not
 * transcribed from the legacy expectations, and each legacy input that survives appears at the
 * **construct's real spelling** where the legacy one did not parse.
 *
 * ## The rule, and why it is the whole point of the file
 *
 * `docs/style.md` §"The semicolon rules" states the rule as a decision table (`;` between items
 * always; after the last item only when the construct is broken over several lines). The same section
 * then rules on it for this printer:
 *
 * > `preserve` cannot implement those cells, and the reason is not a preference: the runtime guard
 * > compares the printed token stream against the tree the printer was given, and **a separator is a
 * > token**. So a `;` the printer adds or removes is a difference the guard must reject.
 *
 * That is the invariant this file asserts directly. Every section below holds the **same construct
 * twice** — once with the source's trailing separator and once without — and the snapshot is the
 * assertion that the printer kept the first and did not invent the second. A printer that computed
 * the table's `ifBreak(";")` cell would print the two spellings identically; a printer that preserves
 * tokens cannot.
 *
 * There is a second half to "between items the rules coincide", and it is provable rather than
 * fortunate: the grammar *requires* a separator between items (`{ a = 1 b = 2 }` fails to parse), so
 * "preserve it" and "always print it" are the same rule there. That is why the two-items-per-line
 * cases below are identity: the source could not have omitted the `;` in the first place.
 *
 * ## Measured
 *
 * One pass over every statement below as ONE program (`.probe/_trailsep4.mts`): our parser accepts the
 * whole file, **all four mocs parse it** (`1.1.0`, `rel1.16`, `pin`, `v2` — each reading `TYPE`, i.e.
 * past the parser to the typechecker), and the output is a **fixed point**. Per-statement columns are
 * in the same probe. The versions measured are `1.1.0`, `1.16.1` (`rel1.16`), `1.16.1-26-g1d57a4fc7b`
 * (`pin`) and `2.0.0-beta.1` (`v2`); the four were chosen because they disagree on grammar, and for
 * this group they happen to **agree on every case below**.
 *
 * ## The adjudications
 *
 * The legacy expectation is the `moc2` target (style.md §"Read this table as the `moc2` target"), and a
 * separator it adds or removes is a `change` by construction, with the copy being the source's own.
 * Each of the nine legacy tests, and what became of it:
 *
 * 1. `automatic semicolons` → sections 1, 5 and 9. Legacy `{}\nA;\n` *appended* a `;` to a line that
 *    was exactly `}`; new `{}\nA;` — the `;` is not there to preserve, so it is not printed. Same for
 *    `{}.A;` → `{}\n.A;` (the break at the `.` seam is preserved too). The fourth legacy case,
 *    `[\n  {\n  abc;\n  }\n  { 123 }\n];`, is **SYNTAX on all four mocs** (an array item `{ 123 }` is
 *    not valid there); section 3 carries the valid spelling instead.
 * 2. `automatic semicolons with line comment` → section 6: all three legacy inputs parse and all three
 *    are `change` for the same un-inventable `;`.
 * 3. `automatic semicolons with block comment` → section 7. One legacy case is `try {\n}\n /*c*/ catch
 *    {}` — `catch` with no binding is SYNTAX on all four mocs, so it is written `catch e {}`. Another
 *    (`... /*c*/ variable {}`) is SYNTAX on all four for the same reason (`variable` there is not a
 *    program head) and is not ported; `docs/grammar-deviations.md` is where a parser-side gap of that
 *    kind belongs, but this one is not a gap — the legacy spelling was never Motoko. The legacy
 *    expectation also *deleted* the leading space in `\n /*c*/ else`; the space is not a token and the
 *    printer keeps the source's comment gap, which is the `change`.
 * 4. `automatic semicolons with multi-line text` → section 11: all eight cases are identity on both
 *    engines. The point is that a `"` literal is one token whose text may contain `{`, `}` and `;` and
 *    the printer must not touch any of it — a line-shape scanner would.
 * 5. `no automatic semicolons before \`else\`, \`catch\`, \`etc.\`` → section 8. The legacy expectation
 *    is right about the *separator* (there is none before `else`) and wrong about the layout (it joined
 *    `else\n{}` and re-indented `  else`). The new outputs keep the source's breaks.
 * 6. `add trailing delimiters` → section 9. The legacy expectation *adds* a trailing `,` and a `;` and
 *    breaks the group; new output is the group on one line with the source's own separators. Every
 *    cell it added is a separator, so every one is inert here.
 * 7. `remove trailing delimiters` → section 9. `(a,b,c,)` → the legacy expectation drops the comma;
 *    new output is `(a, b, c,)` — the comma is a token, so it is kept. This is the cleanest single
 *    statement of the invariant in the file: the input has a trailing separator, and it survives.
 * 8. `trailing semicolon after block comment` → section 12: identity. The legacy cases are already
 *    canonical and are kept as the positive control for "the printer does not *remove* a separator".
 * 9. `trailing comma in square brackets` → section 10. Two legacy inputs are SYNTAX on all four mocs
 *    (`x : [\n  { abc; }\n];` and the `public type` block — `abc;` is not a field type, and `public` is
 *    not a top-level form of a bare program); they are replaced by valid spellings. The rest are
 *    `change`: the legacy expectation adds a trailing `,` and breaks the list; new output keeps the
 *    source's.
 *
 * The triage also lists **`replace delimiters`** in this group, and it is Python-2-to-3 style dead: its
 * two inputs, `(a;b;c)` and `{a,b,c}`, are **SYNTAX on all four mocs** (`Missing \`)\`` and `Unexpected
 * input`), so there is no fixture to write — the old engine accepted them because it shaped lines
 * rather than parsing. They are **deleted**, per triage §"The refusals, measured", which already ruled
 * this exact test: "it read a semicolon-separated tuple and repaired it to a comma-separated one. That
 * is the old algorithm, and there is no new expectation to port."
 *
 * ## The hazard case, kept because the rule is about safety and not taste
 *
 * `docs/semicolons.md` §4 identifies the one place where a "tidy" printer silently changes a program:
 * a `}`-ending statement followed by a `(`- or `[`-starting one needs its `;`, or the two re-glue as
 * an application with **no error** (`.probe/semi-parse.mjs`, `NEG-semi-false-interior-drop` and
 * `ADV-brace-stmt-then-paren-stmt`). The last statement in section 13 is that pair, and it is identity:
 * the printer may not "clean up" the interior `;`, because the input it would produce is a different
 * program. That is the safety half of the invariant, and it is why the file is worth its length.
 *
 * ## Every statement ends in `;` (or is a complete construct that does not need one)
 *
 * This file is formatted as ONE program, so two adjacent statements with nothing between them are a
 * parse error (`Missing ';'`). The legacy tests formatted one fragment at a time and could elide it.
 */

// --- 1. The invariant, in `;`-lists: present is kept, absent is not invented -----------------------
//
// Four constructs, each spelled with and without its trailing `;`. The `let` binding is deliberate:
// the block sits in expression position, so no statement separator is involved and the two spellings
// are compared on exactly one axis. The `b3`/`b4` pair is broken in the source and the printer joins
// it, which is the group-break rule and not a separator rule — but the trailing `;` survives the join
// in `b3` and is absent in `b4`, which is the point.

let b1 = { a; };
let b2 = { a };
let b3 = {
  a;
};
let b4 = {
  a
};

// The interior separator is mandatory (the grammar rejects `{ a b }`), so this pair is identity: the
// source could not have omitted it, and "preserve" and "always print" coincide.

let b5 = { a; b };
let b6 = {
  a;
  b;
};

// The same invariant on a module body. `M2` is the load-bearing half: a printer computing the table's
// cell would put a `;` after `1`, and the source has none.

module M1 { let a = 1; };
module M2 { let a = 1 };

// --- 2. The same invariant on object and variant types ---------------------------------------------
//
// These are the `semi_sep` / `semi_sep1` rows. `T2` and `T4` are single-item lists, which is where the
// table's note about `seplist1` matters: `{ #ok : A }` has no printed `;` on one line, and the source
// that wrote one keeps it.

type T1 = { #ok : A; };
type T2 = { #ok : A };
type T3 = { x : Nat; };
type T4 = { x : Nat };
type T5 = { #a : Nat; #b : Text };

// --- 3. The invariant in comma-separated lists: `[]`, `()`, call arguments -------------------------
//
// The comma family is where style.md's caution bites: `[1 2]` and `(1 2)` do not fail to parse, they
// parse as a *call* and as an *index*, so a comma here is never a style choice the printer may make.
// The source's comma is a token like any other, and the pairs are the evidence.

let a1 = [ 1, ];
let a2 = [ 1 ];
let t1 = ( 1, 2, );
let t2 = ( 1, 2 );
let c1 = f( 1, );
let c2 = f( 1 );

// The valid spelling of the legacy `automatic semicolons` fourth case (its `{ 123 }` item is SYNTAX on
// all four mocs). `[{ abc; }]` is a one-element array whose element is a block, and the second line is
// the same array with the source's trailing comma.

let k1 = [ { abc; } ];
let k2 = [ { abc; }, ];

// --- 4. `;` inside a broken list, and the trailing comma after it ----------------------------------
//
// `let v`/`let w` are the invariant on an array of records: `[{ a = 1; }]` is the same list, once with
// the source's trailing `,` and once without. The printer joins both to one line and keeps whichever
// comma the source wrote — including in the inner record, where `a = 1;` is the source's own.

let v = [
  { a = 1; },
];
let w = [
  { a = 1; }
];

// --- 5. `automatic semicolons`, re-derived ---------------------------------------------------------
//
// The legacy test's four line-shapes, reduced to the two facts they were encoding. A `}`-ending
// expression statement followed by a newline is a complete statement, and the newline is a *gap*, not a
// separator: the printer does not append `;` to make one. `{}\nA;` and `{};\nA;` are different
// programs and the printer tells them apart.

{
}
A;
{
}
.A;
if () {
}
else {};

// `{}` then a blank line then `{}`: two complete statements, so the file is valid, and neither
// trailing `;` is invented. The blank line is the one-blank-line rule, not this group's subject —
// it is here because the legacy case `{}\n\n{};` is the pair (`{}` with, `{}` without) side by side.

{
}

{
};
{
}

{
}

// --- 6. `automatic semicolons with line comment` ---------------------------------------------------
//
// A `//` comment is an item in the block's own list, so the gap that decides the layout is the one
// after it, and the `}` is *inside* the block's break. The `;` the legacy test appended after `}` is
// still not there. The comment is printed verbatim (triage §"Comments"), never converted.

{
// }
}
A;
{
//
}
A;
{
}
//
A;

// --- 7. `automatic semicolons with block comment` --------------------------------------------------
//
// The first case is one top-level block comment whose *text* contains a `{`, a `}`, a `;` and braces —
// identity, and the reason a line-shape scanner gets this wrong. It is `expectFormatted` in the legacy
// suite and remains so.

/*

{
// }
};
A

*/

{
}
/**/
A;
{
/**/
}
A;
if () {
}
 /*c*/ else {};
try {
}
 /*c*/ finally {};
{
}
 /*c*/ .A;

// --- 8. No `;` before `else`, `catch` or `finally` -------------------------------------------------
//
// The separator half of this legacy test survives exactly: there is never a `;` before `else`. The
// layout half does not. The legacy expectation joined `else\n{}` to `else {}` and stripped the
// two-space indent from `  else`; the new printer keeps the source's break, because the break is a
// gap the author wrote and the group has no hard break of its own to replace it with.

if a {}
// Comment
else {};
if a
{}
// Comment
else {};
if a {
}
// Comment
else {};
if a {
}

// Comment
else {};
if a {
}
// Comment
  else
{};
try {}
// Comment
catch e {};
try {}
// Comment
finally {};

// --- 9. Add / remove trailing delimiters -----------------------------------------------------------
//
// Both legacy tests are the invariant read in opposite directions, and both are `change`.
//
// `add trailing delimiters` asserted that a group broken in the source gets a trailing `,` and a
// trailing `;` appended. Neither exists in the source, so neither is printed: the group fits on one
// line and is joined, and the source's own separators are all that survive.
//
// `remove trailing delimiters` asserted that `(a,b,c,)` loses its comma. It is a token, so it does not:
// the output is `(a, b, c,)`. That is the single clearest statement of the invariant in this file.

(a
,b,c);
(a
,b,c,);
(a,b,c,);
(a, b, c);

// --- 10. Trailing comma in square brackets ---------------------------------------------------------
//
// The legacy expectations add a trailing `,` and re-indent the list. The new printer joins what fits
// (`[\na,b]` is a list with a source break that has no hard break of its own, so it comes back on one
// line) and keeps the source's comma either way. `x : [\nT\n]` is the exception in the other
// direction: a type `[T]` keeps the source's break, because the printer reproduces the `typ_path`
// node's children's gaps rather than computing a break for it.

[
a,b];
[
a,];
x : [
T
];
let z1 : [ { abc : Nat } ] = 1;
let k = [
  {
    abc;
  },
];

// --- 11. Multi-line text: the literal is one token ------------------------------------------------
//
// All eight legacy `expectFormatted` cases, all identity. The `"` literals contain `{`, `}` and `;`
// and the point is that a *token's* text is reproduced byte for byte — including the blank lines and
// the leading spaces on continuation lines. The `"\"" # "..."` case keeps the concatenation `#` seam
// and its spaces too.

"

{
// }
}
A

";
"\"" # "

{
// }
}
A

";
"{
}";
"
{
}";
"{
}
";
"
{
}
";
"

{
}
";
"
{
}

";

// --- 12. A trailing semicolon after a block comment (positive control) -----------------------------
//
// Both legacy cases are identity, and they are here to pin the *other* direction of the invariant: the
// printer must not remove a separator the source wrote. `x;` keeps its `;` and the comment follows on
// its own line.

x;
/**/
x;
/*
*/

// --- 13. Switch arms: the one row where preserve and moc2 differ, and the interior-separator hazard -
//
// `docs/style.md` rules that between switch arms there is never a `;` (the `case` keyword ends the
// previous arm), and that after the last arm `preserve` keeps whatever the source had while `moc2`
// drops it. Both spellings are below, and both are identity — measured (`.probe/_switchsemi5.mts`):
// the named node tree is equal and the *token stream* differs by exactly the `;`, which is why this is
// a real edit and not a no-op, and why `preserve` may not make it.
//
// The `func` case is the hazard from `docs/semicolons.md` §4: a `}`-ending statement followed by a
// `(`-starting one needs its interior `;`, or `let x = 1 (x, 2).0` re-glues as an application with no
// syntax error. Identity, and load-bearing.

switch x { case 1 { a }; case 2 { b } };
switch x { case 1 { a }; case 2 { b }; };
switch x { case 1 a; case 2 b };
func f9() : Nat { let x = 1; (x, 2).0 };
