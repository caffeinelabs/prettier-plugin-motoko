/**
 * Whitespace at the edges of a file, blank lines between statements, and the inner spacing of
 * `{`/`[`/`(`.
 *
 * ## Where this file comes from
 *
 * Four legacy tests — `empty`, `trailing newline`, `extra whitespace`, `bracket spacing` — hold 7
 * cases, 6 of which already print to their expectation and 1 of which does not. The one that does not
 * is the `bracketSpacing` case discussed below, and it is a change `docs/style.md` asks for rather
 * than a regression to fix.
 *
 * ## The rules, from `docs/style.md`
 *
 * - **§Blank lines.** "At most one consecutive blank line in the output, and the printer never
 *   invents one. Runs of two or more blanks collapse to one; leading and trailing blanks inside a
 *   file are dropped." The document gives this exact case as its own testable claim:
 *   `format('\n\na;\n\n\nb;\n\n')` → `'a;\n\nb;\n'`. The first two sections below are that rule, minus
 *   the leading blanks — see the note on file edges.
 * - **§Conflict rulings 1.** Inner spacing of record literals follows `bracketSpacing`, default
 *   `true`. The legacy suite asserts `format('{abc}')` → `'{ abc }\n'`, which is the ruling's own
 *   stated evidence, and the section on inner spacing below is that ruling.
 *
 * ## Why the leading-blank half of the rule is not here
 *
 * "Leading blanks are dropped" cannot be pinned by a fixture that *starts* with leading blanks,
 * because this file starts with this comment. The rule is real and it is measured
 * (`.probe/_layoutmore.mts`: `'\n\na;\n\n\nb;\n\n'` → `'a;\n\nb;\n'`), it just needs a fixture with no
 * header, which belongs to the options/first-print PR. What this file pins is the other half: blanks
 * at the end of the file, in the last section.
 *
 * ## Why `{  abc  }` is the printer's business and `arr[  1  ]` is not
 *
 * Inner spacing comes from one table, `src/printer/parts.ts:LISTS`, where each list kind carries a
 * `spaced` flag. A record literal is `spaced: true` and an array literal is `spaced: false`, so both
 * normalise: the source's extra spaces were never tokens, and the guard has nothing to compare them
 * against (`shapeOf` projects every `Text` gap away, `src/parser/normalize.ts`).
 *
 * `arr[  1  ]` is the exception that shows the rule is a *table* and not a principle. That node is an
 * `array_idx_exp`, and it is **not** in `LISTS` — an index is not a list — so it falls through to
 * `branchDoc`, which reproduces its children's gaps verbatim. So the same bracket pair keeps its
 * spaces in one position and loses them in another, and the fixture pins both spellings side by side.
 *
 * ## The deliberate change in this file
 *
 * The legacy `bracket spacing` test's second case passes `{ bracketSpacing: false }` and expects
 * `{abc}`. **That option is not wired up yet** — `.probe/_opts.mts` shows `bracketSpacing: false`,
 * `motokoRemoveLinesAroundCodeBlocks: true` and `motokoSyntax: 'moc2'` all leaving the output
 * unchanged, because the printer reads only `printWidth`/`tabWidth` (`src/printer/walk.ts`) and the
 * plan gives "organize imports on the CST, **and options**" its own M2 PR. So the case is not
 * portable yet, and it is not dropped either: the section below asserts the **default** behaviour,
 * and the option's own fixture belongs in the PR that implements it. Writing `{abc}` here would pin
 * a snapshot this printer cannot produce and pretend the option works.
 */

// --- A run of blanks collapses to one -------------------------------------------------------------
//
// The comment above is followed by two blank lines, and the printer caps the run at one. This is the
// §Blank lines rule's exact shape, and the comment is here rather than only in the header so that the
// gap being tested is an ordinary inter-item gap and not the file-edge special case.

a;


b;

// --- One blank line is preserved as written -------------------------------------------------------
//
// The other half of the rule: a single blank line is not *removed* either. This pair is already
// canonical, and it is here so that a printer which collapsed every blank would fail.

c;

d;

// --- A blank line after a comment -----------------------------------------------------------------
//
// The comment is an item in the file's own list, so the gap that decides the blank is the one *after*
// it. It behaves like any other inter-item gap: two blanks collapse to one, and the comment stays on
// its own line. Measured in `.probe/_layoutmore.mts`.

// two blanks follow this comment


e;

// --- Inner spacing comes from the list table, not from the source ---------------------------------
//
// Three spellings of one record literal and two of one array literal. Each group collapses to a
// single output — records spaced, arrays not — because the spacing is a `spaced` flag in
// `src/printer/parts.ts:LISTS` and the source's spaces were never tokens.

let r1 = {abc};
let r2 = { abc };
let r3 = {  abc  };

let a1 = [  1  ];
let a2 = [1];

// --- The exception: an index expression is not a list ---------------------------------------------
//
// The same bracket pair in two grammatical positions, printing differently. `[  1  ]` on the right of
// `=` is an `array_exp`, a list, so it normalises. `arr[  1  ]` is an `array_idx_exp`, which is *not*
// in `LISTS`, so its gaps are reproduced verbatim and the spaces survive.

let arr = [  1  ];
let indexed = arr[  1  ];

// --- The same for `(` and for call arguments ------------------------------------------------------
//
// `par_exp` is a list with `spaced: false`, and so is a call's argument list, so both normalise.

let p = (  1  );

f( 1, 2 );

// --- Trailing blank lines at the end of the file --------------------------------------------------
//
// Blanks at the end of the file are dropped, and the file still ends in exactly one newline. Nothing
// follows this statement, so the run below is a file-edge run and not an inter-statement one.

f;


