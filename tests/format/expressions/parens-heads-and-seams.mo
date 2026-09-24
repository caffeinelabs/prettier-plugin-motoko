/**
 * Parens, heads and the seams where a bracket is *not* a layout choice.
 *
 * ## Where this file comes from
 *
 * Three legacy tests, grouped by `docs/fixture-triage.md`:
 *
 * - `conditional parentheses` (triage: **change** — "the highest-value test in the whole suite after
 *   the adjacency group"). Its four cases are below. The legacy expectation happens to be identical
 *   to the input for all four, and so is ours, but the *reason* has changed: the old engine kept
 *   them by not touching the parens, and this one keeps them because `preserve` has no rule that
 *   could remove them — see "why `preserve` cannot drop a paren" below.
 * - `dot after group` and `tuple indices` (triage: keep — "whitespace adjacency and operators, the
 *   safety core"), with `docs/adjacency.md`'s table winning wherever the two disagree. The two
 *   disagreements are the first two adjudications below.
 * - `parenthesized \`with\` expression prefixes` and `no delimiter for record extension` (triage:
 *   keep), the latter as the positive control for a bracket that *is* re-spaced.
 * - `wildcard identifier` (triage group: construct coverage). The legacy test is eight fragments;
 *   four spell a `case`/`catch` clause with no `switch` around it, which no moc accepts as a
 *   program. See "the four fragments".
 *
 * ## Measured
 *
 * One pass (`.probe/_parensfinal.mts`) over the exact 25 statements below: our parser accepts every
 * one, all four mocs parse every one (the `moc` column reads `TYPE`, i.e. it got past the parser to
 * the typechecker), and **every one is a fixed point**. Three outputs are not the input, and each is
 * adjudicated below: two are legacy `DIFF`s whose legacy expectation the spec overrides, and the
 * third is the deliberate re-spacing of a record literal.
 *
 * ## Every statement ends in `;`
 *
 * This file is formatted as one program, so two adjacent statements with nothing between them are a
 * parse error — `Missing ';'`. The legacy tests formatted one fragment at a time and could elide
 * it; here it is load-bearing. The first draft of this fixture omitted them and failed to parse,
 * which is the sort of thing a snapshot would have happily recorded as printer behaviour.
 *
 * ## The four fragments, and why they are not ported verbatim
 *
 * The legacy `wildcard identifier` test asserts four outputs for the bare fragments `case _ (i)`,
 * `case _ [i]`, `catch _ (i)`, `catch _ [i]`, each expecting the fragment back unchanged. Measured:
 * our parser **accepts** all four (so the fixture would snapshot fine) but **all four mocs reject
 * them as SYNTAX** — a `case` or `catch` clause is not a program. Porting them would bake a
 * tree-sitter-only spelling into a snapshot and call it printer behaviour;
 * `docs/grammar-deviations.md` is where that class of gap belongs. The *identical* seam is
 * exercised below inside a real `switch`, where all four mocs accept it: `switch x { case _ (i) 1 }`.
 *
 * ## Why `preserve` cannot drop a paren
 *
 * `docs/formatter-rework.md` states the flat-precedence finding: the printer may never add or remove
 * parens around operators. That is a property of `preserve` rather than a check the printer
 * performs — a parenthesised expression is a `par_exp` node with a `(` token child, and a separator
 * or delimiter is a token, which `preserve` reproduces rather than invents. So `if a (b)` stays
 * `if a (b)` and `if (a) (b)` stays `if (a) (b)`: the parens are the author's and the printer's job
 * is to not lose them. `tests/adjacency.test.ts` item 1 (paren-wrap a compound head) is the
 * complementary `moc2` rewrite and is deliberately *not* implemented here.
 *
 * ## The adjudications
 *
 * Cases whose legacy expectation is **not** the output the spec asks for. Each is a `DIFF` in the
 * probe and each is written below as the correct output:
 *
 * 1. `(\n\n\n).0` -> `(\n\n).0`. A run of blank lines collapses to one. The blank survives at all
 *    because the construct already spans lines, so the "one line" rule does not apply to it.
 * 2. `(\na\n).0` -> `(a).0`. Fits `printWidth`, has no hard break of its own, so it goes on one line
 *    (`docs/style.md` §"Blocks, records, object types: one line vs broken"). The legacy expectation
 *    re-indented it across lines *and appended a `;`* the source does not have.
 * 3. `0.\ny` -> `0.\ny`. `0.` is a single `int_literal` token, so the source break is inside the
 *    node's children and is reproduced. The legacy expectation added a statement `;` that
 *    `preserve` cannot invent — the same un-inventable-separator reason as the rest of the port.
 * 4. `_ (i)` and `_ [i]` -> unchanged. The gap is the general `call_exp`/`idx_exp` seam, not a
 *    wildcard rule: `f  (i)` is preserved too (measured, `.probe/_seam.mts`), which is what shows
 *    the behaviour is the seam and not the wildcard. The legacy expectation closes the gap; ours
 *    would have to *invent* a rule for one callee spelling and not another.
 *
 * The controls for 1–2 are `().0` and `x.0.y`: identical in both engines, so the DIFFs are the
 * group-break rule and not a changed tuple-index rule.
 */

// --- Conditional parentheses: the author's parens survive ------------------------------------------
//
// Four spellings of the same question — is the head parenthesised, is the branch? — and all four are
// fixed points. The pair is the point: `if (a) b` and `if a (b)` differ only in *which* side carries
// the parens, and neither is normalised into the other.

if a b;

if (a) b;

if a (b);

if (a) (b);

// --- A dot after a group ---------------------------------------------------------------------------
//
// `().0` and `x.0.y` are the controls: both engines agree, so anything that moves below is the
// group-break rule and not the tuple-index rule.

().0;

x.0.y;

// Adjudication 1. This is the one case here whose output differs from its input by *removing*
// something, and what it removes is whitespace, which the AST guard cannot see.

(


).0;

// Adjudication 2. Broken in the source, but it fits on one line and has no hard break of its own,
// so it is joined. The parens are kept because they are tokens; only the text inside is re-laid.

(
a
).0;

// --- Tuple indices ---------------------------------------------------------------------------------
//
// A numeric field name is not a float. `0. y` keeps its space (the dot binds `0.` and `y` is a
// separate token) and `0.\ny` keeps its break for the same reason — adjudication 3.

0. y;

0.
y;

// --- A wildcard callee, and the seam that is not about wildcards -----------------------------------
//
// The first two are the legacy `expectFormatted` cases. The next two are the legacy DIFFs, kept
// exactly as written because the gap is the general call/index seam — adjudication 4. The final pair
// is the legacy `case`/`catch` spelling moved inside a real `switch`, where all four mocs accept it.

_(i);

_[i];

_ (i);

_ [i];

switch x { case _ (i) 1 };

switch x { case _ [i] 1 };

// --- `with` expression prefixes --------------------------------------------------------------------
//
// A parenthesised `with` prefix keeps its parens and its internal `;` separators for the same token
// reason. The two broken spellings show the group's own break is reproduced when the source already
// spans lines, rather than being forced back onto one.

(with a = 1) actor {};

(with a = 1; b = 2) actor {};

(m with a = 1) actor {};

(m with a = 1; b = 2) actor {};

(m with a = 1)
actor {};

(with a = 1)
actor {};

(
  m with
  a = 1;
  b = 2;
)
actor {};

// --- Record extension: the positive control --------------------------------------------------------
//
// This bracket *is* re-spaced — `{base with a = 1}` becomes `{ base with a = 1 }` — because a record
// literal is a list node the printer lays out. It is here so the file does not read as "brackets are
// never touched": they are, wherever the printer owns the construct. Note there is no `,` before
// `with` and no `;` after it, and neither is invented.

{base with a = 1};
