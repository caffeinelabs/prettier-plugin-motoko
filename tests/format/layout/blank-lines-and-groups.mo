/**
 * Blank lines, and the layout of a group that fits on one line versus one that breaks.
 *
 * ## Where this file comes from
 *
 * The ten Layout cases `docs/fixture-triage.md` lists under "Layout — keep, but beware", minus the
 * two already ported into `tests/format/layout/whitespace-and-brackets.mo`:
 *
 * | legacy test                       | below? | verdict                                                                 |
 * | --------------------------------- | ------ | ----------------------------------------------------------------------- |
 * | `empty block`                     | yes    | **change** — the legacy `;` is not invented; the blank is kept, not made |
 * | `extra newlines`                  | yes    | keep                                                                    |
 * | `group spacing`                   | yes    | keep (with one reading made explicit)                                    |
 * | `nested group line breaks`        | yes    | **change** — the outer group breaks too                                  |
 * | `tuple line breaks`               | yes    | keep (identity)                                                          |
 * | `anonymous function line break`   | yes    | **change** — it fits, so it joins                                        |
 * | `if-else wrapping`                | yes    | **change** — it fits, so it joins; the legacy `;` is not invented        |
 * | `type binding line breaks`        | no     | not portable — the legacy source is not a program (below)                |
 * | `lines before/after group`        | half   | the default-option half only (below)                                     |
 * | `block with existing newline`     | yes    | **change** — it fits, so it joins                                        |
 * | `extra whitespace`, `bracket spacing` | no | already in `whitespace-and-brackets.mo`                                  |
 *
 * ## The rule, from `docs/style.md`
 *
 * **§Blank lines.** "At most one consecutive blank line in the output, and the printer never invents
 * one. Runs of two or more blanks collapse to one." The document names its own two cases, and both
 * are below: `format('a;\n\n\n\n\nb')` → `'a;\n\nb;\n'`, and the same run next to a comment.
 *
 * **§Blank lines inside bodies.** "Kept as written, up to one." That is what decides the surprising
 * half of this file: a blank line is *kept* when the construct it sits in is printed across lines,
 * and it has nowhere to live — so it disappears — when the construct joins onto one line. Neither
 * direction is the printer inventing or destroying a blank for its own reasons.
 *
 * **§Blocks, records, object types: one line vs broken.** "Print one line if the whole construct fits
 * in `printWidth` and contains no hard break of its own. Otherwise break: one item per line, each
 * indented one level, closing delimiter on its own line." A hard break of its own is "an item that
 * cannot be printed on one line itself — a nested broken block, a multi-line string, a line comment".
 * That sentence is the whole difference between the keep cases and the changes here.
 *
 * ## Measured
 *
 * One pass, `.probe/_layoutblank.mts` (the exact legacy byte strings) plus `.probe/_layouttype.mts`,
 * `.probe/_layoutbreak.mts`, `.probe/_layoutempty.mts` and `.probe/_layoutblankbreak.mts` for the
 * controls. Every statement below is accepted by our parser and by **all four** mocs — the `moc`
 * column reads `TYPE`/`OK`, never `SYNTAX` — and the file's output is a fixed point
 * (`.probe/_layoutwhole.mts`). The probe labels the four builds `1.1.0`, `rel1.16`, `pin`, `v2`; their
 * `--version` strings are recorded in `docs/adjacency.md` and they **disagree on grammar** elsewhere in
 * the port, so the agreement here is a measurement and not an assumption.
 *
 * ## Every statement ends in `;`
 *
 * This file is formatted as one program. The legacy tests formatted one fragment at a time, so a
 * fragment like the `extra newlines` case's trailing `b` carried no `;`; here it must have one or the
 * harness reports `Missing ';'`. The added `;` is the only edit made to any legacy source below, and
 * where it changes the shape it is called out.
 *
 * ## The adjudications
 *
 * Five cases print to something other than the legacy expectation. None is a printer bug: each is
 * `docs/style.md`'s rule applied to a construct the old engine laid out by line-shape.
 *
 * 1. **`empty block`, `{\n\n}`.** Legacy expected `'{\n\n};\n'`; measured output is `'{\n\n}\n'`. Two
 *    separate claims are tangled in the legacy string and they separate cleanly.
 *    - *The blank line* is **kept**, because the author wrote it and the construct is already across
 *      lines — the §Blank lines rule preserves a written blank. The triage note ("the new formatter
 *      should not invent a blank line there") is about *inventing*, and this printer does not: it
 *      prints `{}` for `{}`, `{}` for `{\n}`, and `{\n\n}` only where the source had it. Measured,
 *      `.probe/_layoutempty.mts`.
 *    - *The `;`* is **not invented**. `preserve` has no `ifBreak(";")`: a `;` is a token, and this
 *      printer reproduces tokens rather than synthesizing them. `docs/style.md` states this exact
 *      case in its own words under §"Interaction with the ported fixture expectations": "`preserve`
 *      keeps the blank line (the empty-list branch in `listDoc`) and omits the `;`."
 *
 *    So the change is the trailing `;`, and the blank line is a *keep* that happens to be inside the
 *    changed string.
 * 2. **`block with existing newline`, `{a;\nb}`.** Legacy expected `'{\n  a;\n  b;\n};\n'` — broken
 *    and `;`-terminated. Measured: `'{ a; b }\n'`. The construct fits in `printWidth` and owns no
 *    hard break, so §"Blocks…" joins it, and the joins are the author's own `;`. The control is that
 *    a block which *does* own a hard break stays broken — see the anonymous-function section.
 * 3. **`anonymous function line break`, `(func() {\na\n})`.** Legacy expected `'(\n  func() {\n    a;\n  }\n);\n'`.
 *    Measured: `'(func() { a })\n'`. `a` is a single short expression, so the inner block joins and
 *    then the outer `(` has no hard break to react to and joins too. The legacy expectation both
 *    broke the group and appended a `;` the source never had.
 * 4. **`if-else wrapping`.** Three of the legacy cases are already one line and are identity here
 *    (`if true () else ()`, `if true {} else {}`, `if true (a) else (b)`), so only the fourth is a
 *    change: legacy expected the chain broken one body per line with a trailing `;`; measured
 *    `'if true { a } else if false { b } else { c }\n'`. The chain fits and has no hard break, so it
 *    joins; the `;` is not invented. The control that the rule is *fit*, not "if-else never breaks",
 *    is `.probe/_layoutbreak.mts`'s too-long pair: `if true { …32… } else { …32… }` breaks the second
 *    body, so the printer breaks constructs it must.
 * 5. **`nested group line breaks`.** Legacy expected `'((\n  x,\n  x,\n  x,\n  x,\n  x,\n));\n'` — the
 *    inner tuple broken, the outer paren kept inline. Measured: the outer paren **breaks too**. The
 *    inner tuple is a nested broken block, which §"Blocks…" defines as a hard break of its own, so
 *    the outer group cannot join; and its closing `)` must sit on its own line. The trailing comma on
 *    the inner tuple is the source's own and is preserved.
 *
 * The two keeps that could read as rules this file is not claiming:
 *
 * - **`group spacing`, `{};{a};();(a)`.** The legacy expected `'{}; { a }; (); (a)\n'`, joining the
 *   four statements with a space. Measured: one per line, `'{};\n{ a };\n();\n(a);\n'`. This is not
 *   a spacing rule at all — `source_file` is a `;`-separated list, and a list in this printer is one
 *   item per line. `{ a }` additionally shows the record literal's inner space, which is
 *   `whitespace-and-brackets.mo`'s subject, repeated here only as the by-product of the same line.
 * - **`tuple line breaks`.** The legacy source is already a broken tuple with a source trailing comma
 *   and it prints back byte for byte. It is here as the **identity control** for the nested case:
 *   breaking alone does not move a tuple, only re-nesting it does.
 *
 * ## What is not here
 *
 * - **`type binding line breaks` is not portable.** Both legacy sources are bare fragments —
 *   `<(xxx, …)>;` and `<{ xxx; … }>;` — and **all four mocs and our own parser reject both with
 *   `SYNTAX`** (`.probe/_layoutblank.mts`). Neither is a program, so neither can be a fixture; the
 *   same refusal applies to the two "make it a real declaration" repairs I tried
 *   (`.probe/_layouttype.mts`: `type T = <(…)>;` and `type T = <{ … }>;` are also `SYNTAX` on all
 *   four). Recording a tree-sitter-only spelling and calling it printer behaviour is exactly what the
 *   port must not do; `docs/grammar-deviations.md` is where this class of gap belongs.
 * - **`lines before/after group`'s option half.** The legacy test's four option-dependent cases pass
 *   `motokoRemoveLinesAroundCodeBlocks: true`. The harness (`tests/format.test.ts`) passes one fixed
 *   `OPTIONS` object with no per-file overrides, so an option-dependent case cannot be a fixture, and
 *   the option is not wired up in any case (`.probe/_opts.mts`, cited by
 *   `whitespace-and-brackets.mo`). Only the two default-option `expectFormatted` cases are ported, in
 *   the last section; they are **changes** because this printer joins where the old one preserved.
 */

// --- An empty block: the author's blank is kept, the `;` is not invented --------------------------
//
// Four spellings, four outputs, and the differences are all the author's. `{}` and `{\n}` both print
// `{}` — a bare newline is not a blank line, and there is nothing to join. `{\n\n}` prints its blank
// back because the source is already across lines; see adjudication 1. `{\n\n\n}` is the §Blank lines
// cap applied *inside* a construct rather than between statements. The last pair shows the `;` rule
// directly: an author's `;` is kept, and the one the legacy test expected after a broken empty block
// is not synthesized.

{};

{
};

{

};

{


};

// --- `block with existing newline`: a block that fits is joined -----------------------------------
//
// Adjudication 2. Both spellings fit and own no hard break, so both join; the separators are the
// author's `;` and are neither added nor dropped.

{a;
b};

{
a;
b
};

// --- `extra newlines`: a run of blanks collapses to one -------------------------------------------
//
// `docs/style.md` §Blank lines names its own input for this — `a;\n\n\n\n\nb` → `a;\n\nb;\n` — and
// the run below is that input with the harness-mandated `;` on `b`.

a;




b;

// --- `group spacing`: a `;`-separated list is one item per line -----------------------------------
//
// The four statements juxtaposed on one source line, which is how the legacy test wrote them. The
// separator between them is the author's `;`; the printer is deciding line breaks, not spacing, which
// is why the compact input and the spaced input below print the same way.

{};{a};();(a);

{}; { a }; (); (a);

// --- `tuple line breaks`: the identity control ----------------------------------------------------
//
// A tuple already broken with a source trailing comma. §"Blocks…" breaks it one item per line with the
// closing `)` on its own line, which is what it already is, and `preserve` keeps the trailing comma.
// Nothing here moves — the point is the contrast with the next section.

(
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
);

// --- `nested group line breaks`: a hard break propagates outward ----------------------------------
//
// Adjudication 5. The inner tuple is a nested broken block, so the outer paren owns a hard break and
// must break as well. The source has a source-level space between `,` and the next item and no
// trailing comma; the printed form drops the space and keeps the no-trailing-comma, so the only
// difference from the input is the outer group's break and the indentation it forces.

(
(
xxxxxxxxxxxxxxxxxxxx,
xxxxxxxxxxxxxxxxxxxx,
xxxxxxxxxxxxxxxxxxxx,
xxxxxxxxxxxxxxxxxxxx,
xxxxxxxxxxxxxxxxxxxx));

// --- `anonymous function line break`: fits, so it joins -------------------------------------------
//
// Adjudication 3. `a` is one short expression, so the function body joins and the enclosing paren —
// which was `(` newline `func…` newline `)` — joins with it. The tight spelling beneath is the same
// program written the way the printer prints it, and the pair is a fixed point both ways.

(func() {
a
});

(func() { a });

// --- `if-else wrapping`: the three identity cases, then the change ---------------------------------
//
// Adjudications 4. The first three are one line already, in both engines. The fourth is the legacy
// broken chain, which fits and joins.
//
// The four are deliberately the same *question* — is the branch a paren, a block, or a chain — asked
// four ways, because the only thing that decides their layout is whether they fit.

if true () else ();

if true {} else {};

if true (a) else (b);

if true {
a
} else if false {
b
} else {
c
};

// --- `lines before/after group`: the default-option half ------------------------------------------
//
// The two legacy `expectFormatted` cases, which the old engine returned unchanged: a blank line
// immediately inside a bracket. Measured, both are **changes** — the group fits on one line, so the
// blank has nowhere to live and disappears (`.probe/_layoutbreak.mts`). The option half of the legacy
// test (`motokoRemoveLinesAroundCodeBlocks`) is not portable; see "What is not here".

[

  1,
  2,

];

{

  abc;

};

// --- The other half of the rule: a blank between items of a group that *does* break ---------------
//
// The positive control for the section above — the blank is not simply deleted everywhere, only where
// the group joins and there is no line boundary to hold it. Here the group must stay broken (the line
// comment is a hard break of its own), and the blank the author put between `a` and the comment prints
// back. That the same holds between items of a group broken by *width* is
// `.probe/_layoutblankbreak.mts`, measured (it needs 200 characters of filler, so it is cited rather
// than written here).

{
  a;

  // c
  b;
};
